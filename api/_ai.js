const { GoogleGenerativeAI } = require('@google/generative-ai');
const { MONSTER_SYSTEM_PROMPT, IDENTIFY_PROMPT } = require('./_prompts');

// ---------- Provider: Gemini ----------

async function geminiProfile(monsterName) {
  if (!process.env.GEMINI_API_KEY) return null;
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: MONSTER_SYSTEM_PROMPT + '\n\nTell me everything about this monster: ' + monsterName }] }],
    generationConfig: { temperature: 0.8, maxOutputTokens: 16000, responseMimeType: 'application/json' }
  });
  return JSON.parse(result.response.text().trim());
}

async function geminiIdentify(base64Data, mimeType) {
  if (!process.env.GEMINI_API_KEY) return null;
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [
      { text: IDENTIFY_PROMPT },
      { inlineData: { mimeType, data: base64Data } }
    ] }],
    generationConfig: { maxOutputTokens: 100 }
  });
  return result.response.text().trim();
}

// ---------- Provider: OpenAI ----------

async function openaiProfile(monsterName) {
  if (!process.env.OPENAI_API_KEY) return null;
  const OpenAI = require('openai');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: MONSTER_SYSTEM_PROMPT },
      { role: 'user', content: 'Tell me everything about this monster: ' + monsterName }
    ],
    temperature: 0.8,
    max_tokens: 3000
  });
  return JSON.parse(completion.choices[0].message.content.trim());
}

async function openaiIdentify(base64Data, mimeType) {
  if (!process.env.OPENAI_API_KEY) return null;
  const OpenAI = require('openai');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: IDENTIFY_PROMPT },
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}` } }
      ]
    }],
    max_tokens: 100
  });
  return completion.choices[0].message.content.trim();
}

// ---------- Fallback chains ----------

async function generateProfile(monsterName) {
  const errors = [];

  // 1. Try Gemini
  try {
    const data = await geminiProfile(monsterName);
    if (data) { data._provider = 'gemini'; return data; }
  } catch (err) {
    errors.push('Gemini: ' + err.message);
    console.error('Gemini profile error:', err.message);
  }

  // 2. Try OpenAI
  try {
    const data = await openaiProfile(monsterName);
    if (data) { data._provider = 'openai'; return data; }
  } catch (err) {
    errors.push('OpenAI: ' + err.message);
    console.error('OpenAI profile error:', err.message);
  }

  throw new Error(errors.length ? errors.join(' | ') : 'No AI provider configured. Set GEMINI_API_KEY or OPENAI_API_KEY.');
}

async function identifyFromImage(base64Data, mimeType) {
  const errors = [];

  // 1. Try Gemini
  try {
    const name = await geminiIdentify(base64Data, mimeType);
    if (name) return name;
  } catch (err) {
    errors.push('Gemini: ' + err.message);
    console.error('Gemini identify error:', err.message);
  }

  // 2. Try OpenAI
  try {
    const name = await openaiIdentify(base64Data, mimeType);
    if (name) return name;
  } catch (err) {
    errors.push('OpenAI: ' + err.message);
    console.error('OpenAI identify error:', err.message);
  }

  throw new Error(errors.length ? errors.join(' | ') : 'No AI provider configured. Set GEMINI_API_KEY or OPENAI_API_KEY.');
}

// ---------- Image search: Wikipedia → Google ----------

async function fetchMonsterImage(monsterName) {
  // 1. Try Wikipedia
  try {
    const wikiRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(monsterName)}`);
    if (wikiRes.ok) {
      const wikiData = await wikiRes.json();
      if (wikiData.originalimage?.source) {
        return { url: wikiData.originalimage.source, credit: 'Wikipedia — ' + wikiData.title };
      }
      if (wikiData.thumbnail?.source) {
        return { url: wikiData.thumbnail.source, credit: 'Wikipedia — ' + wikiData.title };
      }
    }
  } catch {}

  // 2. Try Google Custom Search (if configured)
  try {
    const key = process.env.GOOGLE_CSE_KEY || process.env.GEMINI_API_KEY;
    const cx = process.env.GOOGLE_CSE_CX;
    if (key && cx) {
      const q = encodeURIComponent(monsterName + ' monster mythology');
      const url = `https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${q}&searchType=image&num=1&safe=active`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.items?.[0]?.link) {
          return { url: data.items[0].link, credit: 'Google Images' };
        }
      }
    }
  } catch {}

  return null;
}

module.exports = { generateProfile, identifyFromImage, fetchMonsterImage };
