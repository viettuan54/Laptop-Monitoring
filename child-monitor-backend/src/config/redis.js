const { createClient } = require('redis');
const { RedisStore } = require('rate-limit-redis');

const redisUrl = process.env.REDIS_URL?.trim();
let redisClient = null;

if (redisUrl) {
  const parsed = new URL(redisUrl);
  if (!['redis:', 'rediss:'].includes(parsed.protocol)) {
    throw new Error('REDIS_URL must use redis:// or rediss://');
  }

  redisClient = createClient({
    url: redisUrl,
    socket: {
      connectTimeout: 5000,
      reconnectStrategy: (retries) => Math.min(retries * 100, 3000),
    },
  });
  redisClient.on('error', (error) => {
    console.error('[Redis] Client error:', error.message);
  });
}

async function initializeRedis() {
  if (!redisClient) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('REDIS_URL is required in production for distributed rate limiting');
    }
    console.warn('[RateLimit] REDIS_URL is not set; using MemoryStore for development/test only.');
    return false;
  }

  if (!redisClient.isOpen) {
    await redisClient.connect();
  }
  await redisClient.ping();
  console.log('[Redis] Connected; distributed rate limiting is active.');
  return true;
}

function createRateLimitStore(prefix) {
  if (!redisClient) return undefined;

  return new RedisStore({
    prefix: `child-monitor:rate-limit:${prefix}:`,
    sendCommand: (...args) => redisClient.sendCommand(args),
  });
}

async function closeRedis() {
  if (redisClient?.isOpen) {
    await redisClient.close();
  }
}

module.exports = {
  initializeRedis,
  createRateLimitStore,
  closeRedis,
};
