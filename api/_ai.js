const { GoogleGenerativeAI } = require('@google/generative-ai');
const { MONSTER_SYSTEM_PROMPT, IDENTIFY_PROMPT } = require('./_prompts');

// ---------- Helpers ----------

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isRetryable(err) {
  const msg = (err.message || '').toLowerCase();
  return msg.includes('503') || msg.includes('service unavailable') || msg.includes('overloaded') || msg.includes('high demand');
}

// ---------- Provider: Gemini (with retry on 503) ----------

async function geminiCall(contentConfig, genConfig) {
  if (!process.env.GEMINI_API_KEY) return null;
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await model.generateContent({ contents: contentConfig, generationConfig: genConfig });
      return result.response.text().trim();
    } catch (err) {
      if (isRetryable(err) && attempt < MAX_RETRIES - 1) {
        console.log(`Gemini 503 — retrying in ${(attempt + 1) * 2}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await sleep((attempt + 1) * 2000);
        continue;
      }
      throw err;
    }
  }
}

async function geminiProfile(monsterName) {
  const text = await geminiCall(
    [{ role: 'user', parts: [{ text: MONSTER_SYSTEM_PROMPT + '\n\nTell me everything about this monster: ' + monsterName }] }],
    { temperature: 0.8, maxOutputTokens: 16000, responseMimeType: 'application/json' }
  );
  return text ? JSON.parse(text) : null;
}

async function geminiIdentify(base64Data, mimeType) {
  const text = await geminiCall(
    [{ role: 'user', parts: [
      { text: IDENTIFY_PROMPT },
      { inlineData: { mimeType, data: base64Data } }
    ] }],
    { maxOutputTokens: 100 }
  );
  return text || null;
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

  console.error('All profile providers failed:', errors.join(' | '));
  throw new Error('Sorry monster unavailable, try again soon.');
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

  console.error('All identify providers failed:', errors.join(' | '));
  throw new Error('Sorry monster unavailable, try again soon.');
}

// ---------- Image search: Google → Wikimedia Commons → Wikipedia ----------

async function fetchMonsterImage(monsterName) {
  // 1. Try Google Custom Search (best images)
  try {
    const key = process.env.GOOGLE_CSE_KEY;
    const cx = process.env.GOOGLE_CSE_CX;
    if (key && cx) {
      const q = encodeURIComponent(monsterName + ' monster mythology art');
      const url = `https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${q}&searchType=image&num=3&safe=active&imgSize=large`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.items?.[0]?.link) {
          return { url: data.items[0].link, credit: 'Google Images' };
        }
      }
    }
  } catch {}

  // 2. Try Wikimedia Commons (free, no key)
  try {
    const q = encodeURIComponent(monsterName + ' monster');
    const commonsUrl = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${q}&gsrlimit=5&prop=imageinfo&iiprop=url|mime&iiurlwidth=800&format=json&origin=*`;
    const commonsRes = await fetch(commonsUrl);
    if (commonsRes.ok) {
      const commonsData = await commonsRes.json();
      const pages = commonsData.query?.pages;
      if (pages) {
        for (const page of Object.values(pages)) {
          const info = page.imageinfo?.[0];
          if (info && info.mime && info.mime.startsWith('image/') && !info.mime.includes('svg') && !info.mime.includes('pdf')) {
            const imgUrl = info.thumburl || info.url;
            if (imgUrl) {
              return { url: imgUrl, credit: 'Wikimedia Commons' };
            }
          }
        }
      }
    }
  } catch {}

  // 3. Try Wikipedia article image (last resort)
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

  return null;
}

module.exports = { generateProfile, identifyFromImage, fetchMonsterImage };
