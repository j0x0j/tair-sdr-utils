const redis = require('redis')
const redisClient = redis.createClient();

const TTL = 1000 * 30
const DELAY = 1000 * 5

setInterval(() => {
  redisClient.zremrangebyscore('SIGNAL_CACHE', '-inf', (Date.now() - TTL).toString())
}, DELAY)
