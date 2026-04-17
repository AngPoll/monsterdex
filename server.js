const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');
require('dotenv').config();

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB max
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Gemini client ----------
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

// ---------- Prompts ----------
const MONSTER_SYSTEM_PROMPT = `You are MonsterDex, the ultimate encyclopedia of monsters, cryptids, mythological creatures, and legendary beasts from folklore, mythology, fiction, and urban legends worldwide.

When given a monster name, return a comprehensive JSON profile. Be dramatic, vivid, and engaging — this is meant to thrill and educate users of all ages.

Return ONLY valid JSON (no markdown, no code fences, no explanation) with this exact structure:
{
  "name": "string — the monster's most well-known name",
  "aka": ["array of alternative names, titles, or epithets"],
  "origin": "string — mythology, folklore, or fiction source (e.g., 'Greek Mythology', 'Japanese Folklore')",
  "type": "string — creature classification (e.g., 'Sea Beast / Cephalopod', 'Undead / Spirit')",
  "dangerLevel": 1-5,
  "dangerLabel": "one of: Nuisance | Dangerous | Deadly | Catastrophic | World-Ender",
  "emoji": "single fitting emoji for this creature",
  "lore": "string — 2-3 rich, dramatic paragraphs about the creature's origins, history, and legend. Make it vivid and immersive.",
  "stats": {
    "habitat": "string",
    "size": "string — be specific and dramatic",
    "diet": "string",
    "intelligence": "string — level with a descriptor",
    "firstRecorded": "string — earliest known mention with approximate date",
    "status": "string — e.g., Legendary, Extinct, Active in folklore"
  },
  "abilities": [
    {
      "icon": "emoji",
      "name": "Ability Name",
      "description": "Vivid one-to-two sentence description of this power"
    }
  ],
  "weaknesses": ["array of 3-5 weaknesses, each a short descriptive phrase in parenthetical style"],
  "appearances": ["array of 6-10 famous appearances in movies, books, games, TV — include title, medium, and year"],
  "funFact": "string — a surprising, delightful, and memorable fact about this creature"
}

RULES:
- Include 4-6 abilities, each with a unique emoji icon.
- dangerLevel must be an integer 1-5.
- If the query is a real animal, find its closest mythological/monster equivalent or monstrous version in folklore.
- If you truly cannot identify any monster, return: {"error": "No monster found", "suggestion": "Try searching for Kraken, Medusa, Dragon, or Werewolf"}
- Be historically accurate for real folklore but entertainingly dramatic in tone.`;

const IDENTIFY_PROMPT = `Look at this image carefully. Identify what monster, creature, cryptid, or mythological beast this depicts. This could be:
- A drawing, painting, or illustration of a monster
- A statue or sculpture of a creature
- A costume or cosplay of a mythological being
- A toy, figurine, or model
- A screenshot from a movie, game, or TV show
- A real animal that resembles a legendary creature

Respond with ONLY the monster's most common English name (e.g., "Kraken", "Medusa", "Werewolf").
If you truly cannot identify any monster or creature connection, respond with "UNKNOWN" and nothing else.`;

// ---------- Routes ----------

// Text search
app.post('/api/search', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return res.status(400).json({ error: 'Please enter a monster name to search.' });
    }

    const sanitized = query.trim().substring(0, 200);

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
    res.json(monsterData);
  } catch (err) {
    console.error('Search error:', err.message);
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'API key not configured. Add your GEMINI_API_KEY to the .env file.' });
    }
    res.status(500).json({ error: 'Failed to summon monster data. The beast evades us… try again.' });
  }
});

// Image identification
app.post('/api/identify', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image provided.' });
    }

    const base64Image = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype;

    // Step 1 — identify the monster from the image
    const identifyResult = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [
          { text: IDENTIFY_PROMPT },
          { inlineData: { mimeType, data: base64Image } }
        ]
      }],
      generationConfig: { maxOutputTokens: 100 }
    });

    const monsterName = identifyResult.response.text().trim();

    if (monsterName === 'UNKNOWN') {
      return res.json({
        error: 'Could not identify a monster in this image. Try a clearer picture or search by name instead.',
        suggestion: 'Try searching for Kraken, Medusa, Dragon, or Werewolf'
      });
    }

    // Step 2 — get full monster profile
    const dataResult = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [{ text: MONSTER_SYSTEM_PROMPT + '\n\nTell me everything about this monster: ' + monsterName }]
      }],
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 3000,
        responseMimeType: 'application/json'
      }
    });

    const raw = dataResult.response.text().trim();
    const monsterData = JSON.parse(raw);
    monsterData._identified = true;
    monsterData._identifiedAs = monsterName;
    res.json(monsterData);
  } catch (err) {
    console.error('Identify error:', err.message);
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'API key not configured. Add your GEMINI_API_KEY to the .env file.' });
    }
    res.status(500).json({ error: 'Failed to identify the creature. The image is too dark, or the beast does not wish to be known…' });
  }
});

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  🦑  MonsterDex is alive at http://localhost:${PORT}\n`);
});
