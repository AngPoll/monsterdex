const { Redis } = require('@upstash/redis');

// Key prefix for monster cache
const PREFIX = 'monster:';

// Lazy-init Redis client
let redis = null;
function getRedis() {
  if (!redis && process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN
    });
  }
  return redis;
}

// Normalize name for consistent cache keys
function toKey(name) {
  return PREFIX + name.trim().toLowerCase().replace(/\s+/g, '-');
}

/**
 * Get a cached monster by name.
 * Returns the full monster object (with imageUrl/imageCredit) or null.
 */
async function getCachedMonster(name) {
  try {
    const client = getRedis();
    if (!client) return null;
    const data = await client.get(toKey(name));
    return data || null;
  } catch (err) {
    console.error('Cache read error:', err.message);
    return null; // fail open — just skip cache
  }
}

/**
 * Save a monster to the cache.
 * Stores the full monster data plus optional image info.
 * No expiry — monsters are forever.
 */
async function cacheMonster(name, monsterData, imageUrl, imageCredit) {
  try {
    const client = getRedis();
    if (!client) return;
    const record = {
      ...monsterData,
      _cachedAt: Date.now(),
      _imageUrl: imageUrl || null,
      _imageCredit: imageCredit || null
    };
    // Store under the query key
    await client.set(toKey(name), record);
    // Also store under the canonical monster name so variants hit cache
    const canonical = monsterData.name;
    if (canonical && toKey(canonical) !== toKey(name)) {
      await client.set(toKey(canonical), record);
    }
  } catch (err) {
    console.error('Cache write error:', err.message);
    // fail silently — app still works without cache
  }
}

/**
 * Check if Redis is available (env vars are set).
 */
function isCacheAvailable() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

module.exports = { getCachedMonster, cacheMonster, isCacheAvailable };
