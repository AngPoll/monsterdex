const OpenAI = require('openai');
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

    // 2. Not cached — call OpenAI
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: MONSTER_SYSTEM_PROMPT },
        { role: 'user', content: `Tell me everything about this monster: ${sanitized}` }
      ],
      temperature: 0.8,
      max_tokens: 3000
    });

    const raw = completion.choices[0].message.content.trim();
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
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your-api-key-here') {
      return res.status(500).json({ error: 'API key not configured. Go to Vercel → Settings → Environment Variables and set OPENAI_API_KEY.' });
    }
    if (err.message?.includes('API key') || err.message?.includes('Incorrect API') || err.message?.includes('invalid_api_key')) {
      return res.status(500).json({ error: 'Invalid API key. Check your OPENAI_API_KEY in Vercel environment variables.' });
    }
    if (err.message?.includes('model') || err.message?.includes('does not exist')) {
      return res.status(500).json({ error: 'Your OpenAI account may not have access to GPT-4o. Check your plan at platform.openai.com.' });
    }
    if (err.message?.includes('quota') || err.message?.includes('billing') || err.message?.includes('rate_limit')) {
      return res.status(500).json({ error: 'OpenAI API limit reached. Check your billing at platform.openai.com.' });
    }
    res.status(500).json({ error: 'Failed to summon monster data: ' + (err.message || 'Unknown error. Try again.') });
  }
};
