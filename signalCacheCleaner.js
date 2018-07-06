const redis = require('redis')
const redisClient = redis.createClient()

const TTL = 1000 * 60 * 4
const DELAY = 1000 * 10

setInterval(() => {
  redisClient.zremrangebyscore('SIGNAL_CACHE', '-inf', (Date.now() - TTL))
}, DELAY)
