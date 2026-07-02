import { retrieveForBucket } from './retrieval.js';

const AI_MODEL = 'openai/gpt-oss-120b';
const MAX_TOKENS_PER_QUESTION = 1200; // gpt-oss burns tokens on hidden reasoning before the real answer

const RESEARCH_TASKS = [
  {
    num: 1,
    bucket: 'discovery',
    question: 'Why do users struggle to discover new music?',
    focus: 'Stale recommendations, difficulty finding new artists, algorithm safe-zones, and weak exploration loops.',
    ignore: 'Product ideas, unrelated app bugs, pricing, ads, and other research themes.'
  },
  {
    num: 2,
    bucket: 'recommendations',
    question: 'What are the most common frustrations with recommendations?',
    focus: 'Algorithm repetition, personalization gaps, shuffle/radio issues, and lack of recommendation transparency.',
    ignore: 'Product ideas, unrelated crashes, billing, and other research themes.'
  },
  {
    num: 3,
    bucket: 'listeningBehaviour',
    question: 'What listening behaviors are users trying to achieve?',
    focus: 'Mood-based listening, playlist control, queue behavior, offline use, and contextual listening sessions.',
    ignore: 'Product ideas, unrelated technical failures, and other research themes.'
  },
  {
    num: 4,
    bucket: 'repetitiveListening',
    question: 'What causes users to repeatedly listen to the same content?',
    focus: 'Broken shuffle, repetition loops, familiar-music fallback, and playlist recycling.',
    ignore: 'Product ideas, speculative psychology, and other research themes.'
  },
  {
    num: 5,
    bucket: 'userSegments',
    question: 'Which user segments experience different discovery challenges?',
    focus: 'Free vs premium users, mobile vs desktop, and other segment-specific discovery constraints.',
    ignore: 'Product ideas, generic complaints unrelated to segment differences, and other research themes.'
  },
  {
    num: 6,
    bucket: 'productOpportunities',
    question: 'What unmet needs emerge consistently across reviews?',
    focus: 'Repeated user needs, missing controls, transparency gaps, and discovery pain points expressed as needs.',
    ignore: 'Invented solutions, single-review feature requests unless especially distinctive, and other research themes.'
  }
];

function buildReviewText(reviews) {
  return reviews.map(function(review) {
    return 'Review ' + review.globalId + ' [' + review.source + ']: ' + review.review;
  }).join(' | ');
}

function buildQuestionPrompt(task, reviews, totalCount) {
  var reviewText = buildReviewText(reviews);

  return 'You are a UX Research Analyst preparing a research report. Your responsibility is to summarize user feedback objectively. You are not a Product Manager and must not recommend features, priorities, or solutions.\n\n' +
    'RESEARCH-ONLY MODE\n\n' +
    '- Report only observed user behaviors and recurring patterns.\n' +
    '- Do not recommend features.\n' +
    '- Do not propose solutions.\n' +
    '- Do not prioritize improvements.\n' +
    '- Do not write "Spotify should..."\n' +
    '- Do not write "A good solution would be..."\n' +
    '- If users request a feature, report it as user feedback, not as your recommendation.\n\n' +
    'Correct:\n' +
    '"Multiple users requested a way to reject unwanted recommendations."\n\n' +
    'Incorrect:\n' +
    '"Spotify should add a Dislike button."\n\n' +
    'Question: ' + task.question + '\n\n' +
    'Focus on: ' + task.focus + '\n' +
    'Ignore: ' + task.ignore + '\n\n' +
    'Evidence rules:\n' +
    '- Only report findings that are supported by at least two different reviews.\n' +
    '- If a pattern appears in only one review, you may report it ONLY if it is especially distinctive, and in that case the Observation MUST start with "(Single-review finding)" so readers know the evidence is weaker.\n' +
    '- Do not invent causes or product ideas.\n' +
    '- Stay grounded in the supplied review evidence.\n\n' +
    'Output format: Return 4-6 findings. For each finding include:\n' +
    '- Observation\n' +
    '- Supporting evidence (cite using the exact "Review N" numbers shown below — these are fixed IDs from the full review set, not sequential)\n' +
    '- Why it matters\n\n' +
    'Do not include conclusions or recommendations.\n\n' +
    'Corpus size: ' + totalCount + ' total reviews collected. ' + reviews.length + ' relevant reviews supplied below.\n' +
    'Reviews: ' + reviewText;
}

async function callGroq(apiKey, prompt, attempt) {
  attempt = attempt || 1;

  var groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: MAX_TOKENS_PER_QUESTION,
      temperature: 0.7,
      reasoning_effort: 'low'
    })
  });

  if (groqRes.status === 429 && attempt < 3) {
    var retryAfterHeader = groqRes.headers.get('retry-after');
    var waitMs = retryAfterHeader ? (parseFloat(retryAfterHeader) * 1000) : (attempt * 5000);
    await new Promise(function(resolve) { setTimeout(resolve, waitMs); });
    return callGroq(apiKey, prompt, attempt + 1);
  }

  var data = await groqRes.json();

  if (data.error) {
    throw new Error('Groq error: ' + data.error.message);
  }

  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error('Unexpected response from Groq API.');
  }

  var content = data.choices[0].message.content || '';

  // Known Groq bug: gpt-oss models sometimes leak <think>/reasoning text into
  // the content field even though reasoning is supposed to stay in a separate
  // "reasoning" field. Strip anything before the first numbered/dashed finding
  // if raw reasoning markers are detected.
  content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  if (!content) {
    throw new Error('Groq returned empty content (likely all reasoning tokens, no answer). Try again or raise max_completion_tokens.');
  }

  return content.trim();
}

async function analyzeQuestion(task, reviews, totalCount, apiKey) {
  var retrievedReviews = retrieveForBucket(reviews, task.bucket);
  var prompt = buildQuestionPrompt(task, retrievedReviews, totalCount);
  var answer = await callGroq(apiKey, prompt);

  return {
    num: task.num,
    question: task.question,
    answer: answer
  };
}

function combineQuestionAnswers(sections) {
  return sections
    .sort(function(a, b) { return a.num - b.num; })
    .map(function(section) {
      return section.num + '. ' + section.question + '\n' + section.answer;
    })
    .join('\n\n');
}

async function runQuestionBatch(tasks, reviews, totalCount, apiKey) {
  var results = [];
  for (var i = 0; i < tasks.length; i++) {
    var result = await analyzeQuestion(tasks[i], reviews, totalCount, apiKey);
    results.push(result);
  }
  return results;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var GROQ_API_KEY = process.env.GROQ_API_KEY;

  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: 'GROQ_API_KEY environment variable is not set in Vercel.' });
  }

  try {
    var reviews = req.body.reviews;
    var totalCount = req.body.totalCount;

    if (!reviews || !Array.isArray(reviews)) {
      return res.status(400).json({ error: 'Invalid request: reviews array is required.' });
    }

    var indexedReviews = reviews.map(function(review, index) {
      return { source: review.source, review: review.review, globalId: index + 1 };
    });

    var batchOne = RESEARCH_TASKS.slice(0, 3);
    var batchTwo = RESEARCH_TASKS.slice(3);
    var firstBatch = await runQuestionBatch(batchOne, indexedReviews, totalCount, GROQ_API_KEY);
    var secondBatch = await runQuestionBatch(batchTwo, indexedReviews, totalCount, GROQ_API_KEY);
    var analysisText = combineQuestionAnswers(firstBatch.concat(secondBatch));

    return res.status(200).json({ result: analysisText, model: AI_MODEL });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error. Please try again.' });
  }
}
