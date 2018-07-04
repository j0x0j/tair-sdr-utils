const redis = require('redis')
const redisClient = redis.createClient();

const TTL = 1000 * 30
const DELAY = 1000 * 5

setInterval(() => {
  redisClient.zremrangebyscore(['SIGNAL_CACHE', '-inf', (Date.now() - TTL)], () => {
    redisClient.zcount(['SIGNAL_CACHE', '-inf', '+inf'], (err, count) => {
      console.log('cache size: ' + count);
    })
  })
}, DELAY)
