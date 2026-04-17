const { GoogleGenerativeAI } = require('@google/generative-ai');
const { MONSTER_SYSTEM_PROMPT, IDENTIFY_PROMPT } = require('./_prompts');

// ---------- Helpers ----------

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isRetryable(err) {
  const msg = (err.message || '').toLowerCase();
  return msg.includes('503') || msg.includes('service unavailable') || msg.includes('overloaded') || msg.includes('high demand') || (msg.includes('429') && msg.includes('retry in'));
}

// ---------- Provider: Gemini (with retry on 503/429) ----------

const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'];

async function geminiCall(contentConfig, genConfig) {
  if (!process.env.GEMINI_API_KEY) return null;
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

  for (const modelName of GEMINI_MODELS) {
    const model = genAI.getGenerativeModel({ model: modelName });
    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const result = await model.generateContent({ contents: contentConfig, generationConfig: genConfig });
        console.log(`Gemini success with ${modelName}`);
        return result.response.text().trim();
      } catch (err) {
        console.error(`Gemini ${modelName} attempt ${attempt + 1} error:`, err.message?.substring(0, 150));
        if (isRetryable(err) && attempt < MAX_RETRIES - 1) {
          await sleep((attempt + 1) * 3000);
          continue;
        }
        // If quota exceeded, try next model
        if (err.message?.includes('429')) break;
        throw err;
      }
    }
  }
  return null;
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

// ---------- Provider: Claude (Anthropic) ----------

async function claudeProfile(monsterName) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 3000,
      system: MONSTER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: 'Tell me everything about this monster: ' + monsterName }]
    })
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).substring(0, 200)}`);
  const data = await res.json();
  return JSON.parse(data.content[0].text.trim());
}

async function claudeIdentify(base64Data, mimeType) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 100,
      messages: [{ role: 'user', content: [
        { type: 'text', text: IDENTIFY_PROMPT },
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Data } }
      ] }]
    })
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).substring(0, 200)}`);
  const data = await res.json();
  return data.content[0].text.trim();
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

  // 3. Try Claude
  try {
    const data = await claudeProfile(monsterName);
    if (data) { data._provider = 'claude'; return data; }
  } catch (err) {
    errors.push('Claude: ' + err.message);
    console.error('Claude profile error:', err.message);
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

  // 3. Try Claude
  try {
    const name = await claudeIdentify(base64Data, mimeType);
    if (name) return name;
  } catch (err) {
    errors.push('Claude: ' + err.message);
    console.error('Claude identify error:', err.message);
  }

  console.error('All identify providers failed:', errors.join(' | '));
  throw new Error('Sorry monster unavailable, try again soon.');
}

// ---------- Image search: Google → Wikimedia Commons → Wikipedia ----------

async function fetchMonsterImage(monsterName) {
  // 1. Try Google Custom Search (best images) — try multiple queries
  try {
    const key = process.env.GOOGLE_CSE_KEY;
    const cx = process.env.GOOGLE_CSE_CX;
    if (key && cx) {
      const queries = [
        monsterName + ' monster',
        monsterName,
        monsterName + ' creature art'
      ];
      for (const q of queries) {
        const url = `https://www.googleapis.com/customsearch/v1?key=${key}&cx=${cx}&q=${encodeURIComponent(q)}&searchType=image&num=3&safe=active`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (data.items?.[0]?.link) {
            console.log(`Google Image found for "${monsterName}" with query "${q}"`);
            return { url: data.items[0].link, credit: 'Google Images' };
          }
        } else {
          const errText = await res.text().catch(() => '');
          console.error(`Google CSE error (${res.status}): ${errText.substring(0, 200)}`);
          break; // Don't waste queries on auth/quota errors
        }
      }
    } else {
      console.log('Google CSE not configured — missing GOOGLE_CSE_KEY or GOOGLE_CSE_CX');
    }
  } catch (err) {
    console.error('Google CSE exception:', err.message);
  }

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
