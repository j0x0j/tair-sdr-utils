const redis = require('redis')
const redisClient = redis.createClient()

const TTL = 1000 * 60 * 4
const DELAY = 1000 * 10

setInterval(() => {
  redisClient.keys('SIGNAL_CACHE*', (err, keys) => {
    if (err) console.log('SIGNAL CACHE ERROR:', err)
    keys.forEach(key => {
      redisClient.zremrangebyscore(key, '-inf', (Date.now() - TTL))
    })
  })
}, DELAY)
