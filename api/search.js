const { generateProfile, fetchMonsterImage } = require('./_ai');
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

    // 2. Not cached — try Gemini → OpenAI fallback
    const monsterData = await generateProfile(sanitized);

    // 3. Fetch image: Wikipedia → Google fallback
    const image = await fetchMonsterImage(monsterData.name || sanitized);
    const imageUrl = image?.url || null;
    const imageCredit = image?.credit || null;

    // 4. Save to cache under both the user query AND the canonical name
    if (isCacheAvailable()) {
      cacheMonster(sanitized, monsterData, imageUrl, imageCredit).catch(() => {});
    }

    // 5. Include image info in response
    monsterData._imageUrl = imageUrl;
    monsterData._imageCredit = imageCredit;

    res.status(200).json(monsterData);
  } catch (err) {
    console.error('Search error:', err.message);
    if (!process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'No AI provider configured. Set GEMINI_API_KEY or OPENAI_API_KEY in Vercel environment variables.' });
    }
    res.status(500).json({ error: 'All AI providers failed: ' + (err.message || 'Unknown error. Try again.') });
  }
};
