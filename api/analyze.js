import { retrieveForBucket, isPurelyPositive } from './retrieval.js';

const AI_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct'; // 30K TPM on Groq free tier vs 8K for gpt-oss-120b, and not a reasoning model so no hidden token overhead
const MAX_TOKENS_PER_QUESTION = 1000; // safe headroom now that TPM is 30K, not 8K

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

const PROBLEM_FRAMED_BUCKETS = ['discovery', 'recommendations', 'repetitiveListening', 'productOpportunities'];

function buildReviewText(reviews) {
  return reviews.map(function(review) {
    return 'Review ' + review.globalId + ' [' + review.source + ']: ' + review.review;
  }).join(' | ');
}

function buildQuestionPrompt(task, reviews, totalCount) {
  var reviewText = buildReviewText(reviews);
  var problemFramedBuckets = PROBLEM_FRAMED_BUCKETS;
  var sentimentRule = problemFramedBuckets.indexOf(task.bucket) !== -1
    ? 'Sentiment rule: This question is about a problem, struggle, frustration, or unmet need. A review that is purely positive/appreciative with no complaint, wish, or missing-feature language in it (e.g. "I love this app", "best app ever", generic praise) is NOT evidence for this question, even if it happens to mention a relevant feature or topic. Do not report a purely appreciative review as if it revealed a need or frustration. If none of the supplied reviews support a particular angle, simply omit it — do not manufacture a finding from positive-only evidence.\n\n'
    : '';

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
    sentimentRule +
    'Evidence rules:\n' +
    '- Only report findings that are supported by at least two different reviews.\n' +
    '- Every review you cite for a finding must directly state or clearly describe that SAME specific claim — not just be on a related or similar topic. A review about a different aspect of the theme (e.g. wanting fresher content in general) does NOT count as support for a more specific claim (e.g. users going to another app for discovery) even if both are loosely related.\n' +
    '- Do not reinterpret a neutral or positive review as supporting a negative finding. Do not use words like "implies," "implying," "suggests," "indicates," or "underscores" to bridge a review to a claim it does not directly make — if you find yourself reasoning your way from a review to a claim instead of quoting/paraphrasing a direct statement, that review does not count as support.\n' +
    '- Before citing 2 reviews for a finding, check each one individually: does it, on its own, state this exact claim? If only one of them does, treat the finding as single-review.\n' +
    '- This evidence-checking is INTERNAL reasoning only. NEVER write it into your answer. Do not write sentences like "Review N does not directly support..." or "however Review N supports..." — if a candidate review fails the check, silently drop it and cite only the reviews that pass. The reader must never see your evaluation process, only your conclusions.\n' +
    '- Each finding has EXACTLY ONE "Supporting evidence" field. Never write "Supporting evidence" twice within the same finding — gather every citation for that finding into a single field, in one place.\n' +
    '- If a pattern appears in only one review, you may report it ONLY if it is especially distinctive, and in that case the Observation MUST start with "(Single-review finding)" so readers know the evidence is weaker.\n' +
    '- Do not invent causes or product ideas.\n' +
    '- Stay grounded in the supplied review evidence.\n\n' +
    'Output format: Return 3-5 findings. Keep each field to 1-2 sentences — be concise, not exhaustive. For each finding include:\n' +
    '- Observation\n' +
    '- Supporting evidence (cite using the exact "Review N" numbers shown below — these are fixed IDs from the full review set, not sequential. For EVERY review number you cite, include a short quote or close paraphrase, under 12 words, of what that specific review says — never list a bare "Review N" with no quote or paraphrase attached.)\n' +
    '- Why it matters\n\n' +
    'Do not include conclusions or recommendations.\n\n' +
    'Do not add any commentary about your own process — no notes explaining which reviews you excluded and why, no remarks like "no additional findings were included," no mention of finding counts falling short of the target, no phrases like "only N meaningful findings were found," no trailing sentence explaining why the list stops early. If you have fewer than 5 findings, just stop after your last finding — write nothing else. Just output the findings themselves and nothing else.\n\n' +
    'Final check before you answer: for each finding, count how many DIFFERENT review numbers you cited. If that count is 1, the Observation MUST begin with "(Single-review finding)". If you wrote a finding with only one review number and forgot this label, add it now before responding.\n\n' +
    'Corpus size: ' + totalCount + ' total reviews collected. ' + reviews.length + ' relevant reviews supplied below.\n' +
    'Reviews: ' + reviewText;
}

function normalizeFormatting(text) {
  var originalForFallback = text;

  // 1) Strip meta-commentary line-by-line (safer than substring matching,
  // which risks eating real content if it spans punctuation oddly).
  text = text.split('\n').filter(function(line) {
    var l = line.trim();
    if (!l) return true;
    var metaPatterns = [
      /^Note that/i,
      /^No additional findings/i,
      /was not included/i,
      /outside the scope of (the )?research/i,
      /^No\b.*\bincluded\b/i,
      /\bmeaningful findings?\b/i,
      /\bfindings? (were|was) (found|included)\b/i,
      /^only \d+/i,
      /^\d+\.\s*$/  // stray bare numbering like "2." left over from a numbered list
    ];
    return !metaPatterns.some(function(p) { return p.test(l); });
  }).join('\n');

  // 2) Strip "Finding N" headers FIRST, before label normalization adds any
  // ** marks — doing this after caused the Finding-strip regex to greedily
  // eat the leading ** of the next "**Observation:**" label, corrupting it
  // and causing the whole response to look empty. Verified fix via test cases.
  text = text.replace(/\*{0,3}\s*Finding\s*\d+\s*\*{0,3}\s*:?/gi, ' ');

  // 3) Normalize each field label (any mix of asterisks/spacing/an inline
  // finding number like "Observation 1:") to a clean, consistently-bolded
  // label starting on its own line.
  var labels = ['Observation', 'Supporting evidence', 'Why it matters'];
  labels.forEach(function(label) {
    var re = new RegExp('\\*{0,3}\\s*' + label + '\\s*\\d*\\s*\\*{0,3}\\s*:\\s*\\*{0,3}\\s*', 'gi');
    text = text.replace(re, '\n**' + label + ':** ');
  });

  // 3.5) The model is instructed to put "(Single-review finding)" inline at
  // the start of the Observation text, but it sometimes emits the tag on
  // its own line just before the Observation instead. Left alone, that
  // stray line gets trapped at the tail of the PREVIOUS finding's block
  // once we split on "**Observation:**" below (since the split point is
  // *before* the marker, not before the tag). Splice it inside instead.
  text = text.replace(
    /\(\s*single-review finding\s*\)\s*\n+\s*(\*\*Observation:\*\*\s*)/gi,
    '$1(Single-review finding) '
  );

  // 4) Every finding always starts with an Observation line, so split on
  // that and give each resulting block a clean, sequential header.
  var parts = text.split(/(?=\*\*Observation:\*\*)/);
  var findingNum = 0;
  var rebuilt = parts.map(function(part) {
    part = part.trim();
    if (part.indexOf('**Observation:**') !== 0) return '';
    findingNum++;

    // Safety net: if the model emitted "Supporting evidence" twice in one
    // finding (usually because it narrated a rejected review first), merge
    // everything after the 2nd+ occurrence into the first field instead of
    // leaving a duplicate label floating mid-finding.
    var evidenceLabel = '**Supporting evidence:**';
    var firstIdx = part.indexOf(evidenceLabel);
    if (firstIdx !== -1) {
      var lastIdx = part.lastIndexOf(evidenceLabel);
      if (lastIdx !== firstIdx) {
        part = part.slice(0, lastIdx) + part.slice(lastIdx + evidenceLabel.length);
      }
    }

    // Safety net: strip visible reasoning clauses that narrate the
    // evidence-checking process instead of just stating the conclusion
    // (e.g. "Review 24 does not directly support..., however Review 8...").
    part = part.replace(/[^.]*\b(does not directly support|does not support|is not directly supported)\b[^.]*\.\s*/gi, '');
    part = part.replace(/\bhowever,?\s+/gi, '');

    return '**Finding ' + findingNum + '**\n\n' + part;
  });

  var result;
  if (findingNum === 0) {
    // Safety net: if the model used a format we don't recognize, NEVER
    // discard its content — fall back to the lightly-normalized text, or
    // the fully original text if even that came out empty.
    result = text.trim();
    if (!result) result = originalForFallback.trim();
  } else {
    result = rebuilt.filter(Boolean).join('\n\n');
  }

  return result.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

async function callGroq(apiKey, prompt, attempt, tokenBudget) {
  attempt = attempt || 1;
  tokenBudget = tokenBudget || MAX_TOKENS_PER_QUESTION;

  var groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: tokenBudget,
      temperature: 0.7
    })
  });

  if (groqRes.status === 429 && attempt < 3) {
    var retryAfterHeader = groqRes.headers.get('retry-after');
    var waitMs = retryAfterHeader ? (parseFloat(retryAfterHeader) * 1000) : (attempt * 5000);
    await new Promise(function(resolve) { setTimeout(resolve, waitMs); });
    return callGroq(apiKey, prompt, attempt + 1, tokenBudget);
  }

  var data = await groqRes.json();

  if (data.error) {
    throw new Error('Groq error: ' + data.error.message);
  }

  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error('Unexpected response from Groq API.');
  }

  var finishReason = data.choices[0].finish_reason;
  var content = data.choices[0].message.content || '';

  // Known Groq bug: gpt-oss models sometimes leak <think>/reasoning text into
  // the content field even though reasoning is supposed to stay in a separate
  // "reasoning" field. Strip anything before the first numbered/dashed finding
  // if raw reasoning markers are detected.
  content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // If the model ran out of tokens mid-answer, retry with more headroom
  // instead of shipping a cut-off finding. Only calls that actually need it
  // get bumped (up to 2 extra tries), so total token usage across the run
  // stays close to baseline for the questions that don't need it.
  if (finishReason === 'length' && attempt < 3) {
    return callGroq(apiKey, prompt, attempt + 1, tokenBudget + 500);
  }

  if (!content) {
    throw new Error('Groq returned empty content (likely all reasoning tokens, no answer). Try again or raise max_completion_tokens.');
  }

  return normalizeFormatting(content.trim());
}

function filterPositiveOnlyFindings(answerText, reviewsById) {
  var blocks = answerText.split(/(?=\*\*Finding \d+\*\*)/);
  var kept = [];

  blocks.forEach(function(block) {
    if (!block.trim()) return;
    if (block.indexOf('**Finding') !== 0) {
      // Leading fragment before the first "**Finding**" header (shouldn't
      // normally happen post-normalization, but keep it safe rather than
      // silently dropping content).
      kept.push(block);
      return;
    }

    var citedIds = [];
    var re = /Review\s+(\d+)/g;
    var m;
    while ((m = re.exec(block)) !== null) {
      citedIds.push(Number(m[1]));
    }

    if (citedIds.length === 0) {
      kept.push(block);
      return;
    }

    var allPurelyPositive = citedIds.every(function(id) {
      var reviewText = reviewsById[id];
      // If we can't resolve the review, don't drop the finding on that basis.
      return reviewText ? isPurelyPositive(reviewText) : false;
    });

    if (!allPurelyPositive) kept.push(block);
  });

  var findingNum = 0;
  var renumbered = kept.map(function(block) {
    findingNum++;
    return block.replace(/^\*\*Finding \d+\*\*/, '**Finding ' + findingNum + '**');
  });

  return renumbered.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function analyzeQuestion(task, reviews, totalCount, apiKey) {
  var retrievedReviews = retrieveForBucket(reviews, task.bucket);
  var prompt = buildQuestionPrompt(task, retrievedReviews, totalCount);
  var answer = await callGroq(apiKey, prompt);

  if (PROBLEM_FRAMED_BUCKETS.indexOf(task.bucket) !== -1) {
    var reviewsById = {};
    reviews.forEach(function(r) { reviewsById[r.globalId] = r.review; });
    answer = filterPositiveOnlyFindings(answer, reviewsById);
  }

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
