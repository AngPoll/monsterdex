const { GoogleGenerativeAI } = require('@google/generative-ai');
const { MONSTER_SYSTEM_PROMPT } = require('./_prompts');
const { getCachedMonster, cacheMonster, isCacheAvailable } = require('./_cache');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { query } = req.body;
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return res.status(400).json({ error: 'Please enter a monster name to search.' });
    }

    const sanitized = query.trim().substring(0, 200);

    // 1. Check cache first
    if (isCacheAvailable()) {
      const cached = await getCachedMonster(sanitized);
      if (cached) {
        cached._fromCache = true;
        return res.status(200).json(cached);
      }
    }

    // 2. Not cached — call Gemini
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [{ text: MONSTER_SYSTEM_PROMPT + '\n\nTell me everything about this monster: ' + sanitized }]
      }],
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 3000,
        responseMimeType: 'application/json'
      }
    });

    const raw = result.response.text().trim();
    const monsterData = JSON.parse(raw);

    // 3. Fetch Wikipedia image to store with cache
    let imageUrl = null;
    let imageCredit = null;
    try {
      const wikiRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(monsterData.name)}`);
      if (wikiRes.ok) {
        const wikiData = await wikiRes.json();
        if (wikiData.originalimage?.source) {
          imageUrl = wikiData.originalimage.source;
          imageCredit = `Wikipedia — ${wikiData.title}`;
        } else if (wikiData.thumbnail?.source) {
          imageUrl = wikiData.thumbnail.source;
          imageCredit = `Wikipedia — ${wikiData.title}`;
        }
      }
    } catch {
      // Wikipedia fetch failed — no image, that's fine
    }

    // 4. Save to cache (non-blocking)
    if (isCacheAvailable()) {
      cacheMonster(sanitized, monsterData, imageUrl, imageCredit).catch(() => {});
    }

    // 5. Include image info in response
    monsterData._imageUrl = imageUrl;
    monsterData._imageCredit = imageCredit;

    res.status(200).json(monsterData);
  } catch (err) {
    console.error('Search error:', err.message);
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'API key not configured. Go to Vercel → Settings → Environment Variables and set GEMINI_API_KEY.' });
    }
    if (err.message?.includes('API_KEY_INVALID') || err.message?.includes('API key not valid')) {
      return res.status(500).json({ error: 'Invalid Gemini API key. Check your GEMINI_API_KEY in Vercel environment variables.' });
    }
    if (err.message?.includes('RATE_LIMIT') || err.message?.includes('Resource has been exhausted')) {
      return res.status(500).json({ error: 'Gemini API limit reached. Wait a minute and try again.' });
    }
    res.status(500).json({ error: 'Gemini error: ' + (err.message || 'Unknown error. Try again.') });
  }
};
