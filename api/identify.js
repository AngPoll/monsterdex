const { generateProfile, identifyFromImage, fetchMonsterImage } = require('./_ai');
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

    // Step 1 — identify the monster (Gemini → OpenAI fallback)
    const monsterName = await identifyFromImage(base64Image, mimeType);

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

    // Step 3 — get full profile (Gemini → OpenAI fallback)
    const monsterData = await generateProfile(monsterName);

    // Step 4 — fetch image (Wikipedia → Google fallback)
    const image = await fetchMonsterImage(monsterData.name || monsterName);

    // Step 5 — cache the result
    if (isCacheAvailable()) {
      cacheMonster(monsterName, monsterData, image?.url || null, image?.credit || null).catch(() => {});
    }

    monsterData._identified = true;
    monsterData._identifiedAs = monsterName;
    monsterData._imageUrl = image?.url || null;
    monsterData._imageCredit = image?.credit || null;
    res.status(200).json(monsterData);
  } catch (err) {
    console.error('Identify error:', err.message);
    if (!process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'MonsterDex is not configured yet. Please contact the site owner.' });
    }
    res.status(500).json({ error: err.message || 'Something went wrong. Please try again.' });
  }
};

// Tell Vercel not to parse the body (we handle multipart ourselves)
module.exports.config = {
  api: { bodyParser: false }
};
