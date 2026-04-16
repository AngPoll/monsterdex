const OpenAI = require('openai');
const { MONSTER_SYSTEM_PROMPT, IDENTIFY_PROMPT } = require('./_prompts');

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

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Step 1 — identify the monster
    const identifyResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: IDENTIFY_PROMPT },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } }
          ]
        }
      ],
      max_tokens: 100
    });

    const monsterName = identifyResponse.choices[0].message.content.trim();

    if (monsterName === 'UNKNOWN') {
      return res.status(200).json({
        error: 'Could not identify a monster in this image. Try a clearer picture or search by name instead.',
        suggestion: 'Try searching for Kraken, Medusa, Dragon, or Werewolf'
      });
    }

    // Step 2 — get full profile
    const dataResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: MONSTER_SYSTEM_PROMPT },
        { role: 'user', content: `Tell me everything about this monster: ${monsterName}` }
      ],
      temperature: 0.8,
      max_tokens: 3000
    });

    const raw = dataResponse.choices[0].message.content.trim();
    const monsterData = JSON.parse(raw);
    monsterData._identified = true;
    monsterData._identifiedAs = monsterName;
    res.status(200).json(monsterData);
  } catch (err) {
    console.error('Identify error:', err.message);
    if (err.message?.includes('API key') || err.message?.includes('Incorrect API')) {
      return res.status(500).json({ error: 'API key not configured. Set OPENAI_API_KEY in Vercel environment variables.' });
    }
    res.status(500).json({ error: 'Failed to identify the creature. Try a clearer image or search by name.' });
  }
};

// Tell Vercel not to parse the body (we handle multipart ourselves)
module.exports.config = {
  api: { bodyParser: false }
};
