const Redis = require('ioredis')
const config = require('../config/config')
const jwt = require('jsonwebtoken')

const sanitizeHtml = require('sanitize-html')

const redisClient = new Redis({
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  password: config.REDIS_PASS
})

redisClient.on('error', function (error) {
  console.log('Error in Redis', error)
  process.exit(1)
})

redisClient.on('connect', function () {
  console.log('redis connected')
})

module.exports = {
  // cache route details for particular duration(in seconds)
  cacheRoute: function (duration) {
    return async (req, res, next) => {
      const key = '__express__' + sanitizeHtml(req.originalUrl || req.url)
      if (process.env.NODE_ENV === 'sit') return next()
      const cachedBody = await redisClient.get(key)
      if (cachedBody) {
        res.setHeader('is-cache', 1)
        res.setHeader('content-type', 'application/json')
        res.status(JSON.parse(cachedBody)?.status || 200)
        return res.send(cachedBody)
      } else {
        res.sendResponse = res.send
        res.send = (body) => {
          redisClient.set(key, body, 'EX', duration)
          res.setHeader('content-type', 'application/json')
          res.sendResponse(body)
        }
        next()
      }
    }
  },

  // genral request rate limit
  checkRateLimit: async function (threshold, path, ip) {
    // return async function (req, res, next) {
    try {
      // if (process.env.NODE_ENV === 'sit') return
      if (!config.THRESHOLD_RATE_LIMIT) return
      const ipLimit = await redisClient.incr(`${path}:${ip}`)

      if (ipLimit > threshold) {
        // return res.status(status.TooManyRequest).jsonp({ status: jsonStatus.TooManyRequest, message: messages[req.userLanguage].limit_reached.replace('##', messages[req.userLanguage].request) })
        return 'LIMIT_REACHED'
      } else {
        const ttl = await redisClient.ttl(`${path}:${ip}`)
        if (ttl === -1) {
          await redisClient.expire(`${path}:${ip}`, 1800)
        }
        // return next()
        return
      }
    } catch (error) {
      console.log('checkRateLimit', error)
      // return next()
    }
    // }
  },

  // blacklist particular jwt token
  blackListToken: function (token) {
    try {
      const sBlackListKey = `BlackListToken:${token}`
      const tokenData = jwt.decode(token, { complete: true })
      const tokenExp = tokenData.payload.exp
      redisClient.setex(sBlackListKey, tokenExp, 0)
    } catch (error) {
      console.log('blacklist token', error)
    }
  },

  // push data to queue
  queuePush: function (queueName, data) {
    return redisClient.rpush(queueName, JSON.stringify(data))
  },

  // pop data from queue
  queuePop: function (queueName, data) {
    return redisClient.lpop(queueName)
  },

  // pop in bulk from queue,here limit will be number of data you want to pop
  bulkQueuePop: function (queueName, limit) {
    return redisClient.lpop(queueName, limit)
  },

  // returns length of queue
  queueLen: function (queueName) {
    return redisClient.llen(queueName)
  },

  redisClient
}
