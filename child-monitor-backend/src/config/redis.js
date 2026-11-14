const { createClient } = require('redis');
const { RedisStore } = require('rate-limit-redis');

const redisUrl = process.env.REDIS_URL?.trim();
let redisClient = null;
let initialization;
let stopping = false;
const startupTimeoutMs = Number(process.env.REDIS_STARTUP_TIMEOUT_MS || 10000);
if (!Number.isInteger(startupTimeoutMs) || startupTimeoutMs < 100 || startupTimeoutMs > 120000) {
  throw new Error('REDIS_STARTUP_TIMEOUT_MS must be an integer between 100 and 120000');
}

if (redisUrl) {
  const parsed = new URL(redisUrl);
  if (!['redis:', 'rediss:'].includes(parsed.protocol)) {
    throw new Error('REDIS_URL must use redis:// or rediss://');
  }

  redisClient = createClient({
    url: redisUrl,
    socket: {
      connectTimeout: Math.min(5000, startupTimeoutMs),
      reconnectStrategy: (retries) => stopping ? false : Math.min(retries * 100, 3000),
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

  // Share one startup attempt. Its deadline covers connect, handshake and PING,
  // including retry delays; a per-socket connectTimeout alone cannot do this.
  if (!initialization) initialization = (async () => {
    let timer;
    const deadline = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(
        `Redis startup timed out after ${startupTimeoutMs}ms; check Redis availability and REDIS_URL`
      )), startupTimeoutMs);
    });
    try {
      await Promise.race([
        (async () => {
          if (!redisClient.isOpen) await redisClient.connect();
          if (stopping) throw new Error('Redis startup cancelled');
          await redisClient.ping();
        })(),
        deadline,
      ]);
      console.log('[Redis] Connected; distributed rate limiting is active.');
      return true;
    } catch (error) {
      stopping = true;
      if (redisClient.isOpen) redisClient.destroy();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  })();
  return initialization;
}

function createRateLimitStore(prefix) {
  if (!redisClient) return undefined;

  return new RedisStore({
    prefix: `child-monitor:rate-limit:${prefix}:`,
    sendCommand: (...args) => redisClient.sendCommand(args),
  });
}

async function closeRedis() {
  stopping = true;
  if (!redisClient?.isOpen) return;
  // Shutdown cancels pending commands: close() can wait forever for their replies.
  redisClient.destroy();
}

module.exports = {
  initializeRedis,
  createRateLimitStore,
  closeRedis,
};
