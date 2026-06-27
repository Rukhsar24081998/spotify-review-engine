export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get the Groq API key from Vercel environment variable (never exposed to browser)
  const GROQ_API_KEY = process.env.GROQ_API_KEY;

  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: 'GROQ_API_KEY environment variable is not set in Vercel.' });
  }

  try {
    const { reviews, totalCount } = req.body;

    if (!reviews || !Array.isArray(reviews)) {
      return res.status(400).json({ error: 'Invalid request: reviews array is required.' });
    }

    const reviewText = reviews.map((r, i) =>
      `${i + 1}. [${r.source}] ${r.review}`
    ).join(' | ');

    const prompt = `You are a senior product research analyst at Spotify. Analyze these ${totalCount} real user reviews from App Store, Play Store, Reddit, Spotify Community Forum, and Social Media. Answer these 6 questions with detailed bullet points:

1. Why do users struggle to discover new music?
2. What are the most common frustrations with recommendations?
3. What listening behaviors are users trying to achieve?
4. What causes users to repeatedly listen to the same content?
5. Which user segments experience different discovery challenges?
6. What unmet needs emerge consistently across reviews?

Reviews: ${reviewText}`;

    // Call Groq API from server side — key is safe here
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2000,
        temperature: 0.7
      })
    });

    const data = await groqRes.json();

    // Handle Groq-level errors
    if (data.error) {
      return res.status(500).json({ error: `Groq error: ${data.error.message}` });
    }

    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      return res.status(500).json({ error: 'Unexpected response from Groq API.' });
    }

    const analysisText = data.choices[0].message.content;
    return res.status(200).json({ result: analysisText });

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error. Please try again.' });
  }
}
