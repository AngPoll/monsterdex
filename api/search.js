const OpenAI = require('openai');
const { MONSTER_SYSTEM_PROMPT } = require('./_prompts');

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
    res.status(200).json(monsterData);
  } catch (err) {
    console.error('Search error:', err.message);
    if (err.message?.includes('API key') || err.message?.includes('Incorrect API')) {
      return res.status(500).json({ error: 'API key not configured. Set OPENAI_API_KEY in Vercel environment variables.' });
    }
    res.status(500).json({ error: 'Failed to summon monster data. The beast evades us… try again.' });
  }
};
