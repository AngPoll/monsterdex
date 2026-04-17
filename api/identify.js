const { GoogleGenerativeAI } = require('@google/generative-ai');
const { MONSTER_SYSTEM_PROMPT, IDENTIFY_PROMPT } = require('./_prompts');
const { getCachedMonster, cacheMonster, isCacheAvailable } = require('./_cache');

// Vercel serverless: parse multipart manually (no multer)
const { Readable } = require('stream');

async function parseMultipart(req) {
  // Collect raw body
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);

  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=(.+)/);
  if (!boundaryMatch) throw new Error('No multipart boundary found');

  const boundary = boundaryMatch[1];
  const boundaryBuffer = Buffer.from(`--${boundary}`);

  // Split by boundary
  const parts = [];
  let start = buffer.indexOf(boundaryBuffer) + boundaryBuffer.length;

  while (start < buffer.length) {
    const nextBoundary = buffer.indexOf(boundaryBuffer, start);
    if (nextBoundary === -1) break;

    const partData = buffer.slice(start, nextBoundary);
    const headerEnd = partData.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headers = partData.slice(0, headerEnd).toString();
      const body = partData.slice(headerEnd + 4, partData.length - 2); // trim trailing \r\n

      const nameMatch = headers.match(/name="([^"]+)"/);
      const filenameMatch = headers.match(/filename="([^"]+)"/);
      const ctMatch = headers.match(/Content-Type:\s*(.+)/i);

      if (nameMatch) {
        parts.push({
          name: nameMatch[1],
          filename: filenameMatch ? filenameMatch[1] : null,
          contentType: ctMatch ? ctMatch[1].trim() : null,
          data: body
        });
      }
    }

    start = nextBoundary + boundaryBuffer.length;
  }

  return parts;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const parts = await parseMultipart(req);
    const imagePart = parts.find(p => p.name === 'image');

    if (!imagePart || !imagePart.data || imagePart.data.length === 0) {
      return res.status(400).json({ error: 'No image provided.' });
    }

    // 10 MB limit
    if (imagePart.data.length > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'Image too large. Max 10 MB.' });
    }

    const base64Image = imagePart.data.toString('base64');
    const mimeType = imagePart.contentType || 'image/jpeg';

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    // Step 1 — identify the monster from image
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
      return res.status(200).json({
        error: 'Could not identify a monster in this image. Try a clearer picture or search by name instead.',
        suggestion: 'Try searching for Kraken, Medusa, Dragon, or Werewolf'
      });
    }

    // Step 2 — check cache for this monster
    if (isCacheAvailable()) {
      const cached = await getCachedMonster(monsterName);
      if (cached) {
        cached._identified = true;
        cached._identifiedAs = monsterName;
        cached._fromCache = true;
        return res.status(200).json(cached);
      }
    }

    // Step 3 — not cached, get full profile from Gemini
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

    // Step 4 — cache the result
    if (isCacheAvailable()) {
      cacheMonster(monsterName, monsterData, null, null).catch(() => {});
    }

    monsterData._identified = true;
    monsterData._identifiedAs = monsterName;
    res.status(200).json(monsterData);
  } catch (err) {
    console.error('Identify error:', err.message);
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

// Tell Vercel not to parse the body (we handle multipart ourselves)
module.exports.config = {
  api: { bodyParser: false }
};
