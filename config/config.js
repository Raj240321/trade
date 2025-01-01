require('dotenv').config()
console.log((process.env.NODE_ENV || 'local'), 'Server Start...')
const environment = {
  PORT: process.env.PORT || 1101,
  NODE_ENV: process.env.NODE_ENV || 'local',
  MONGO_URL: process.env.MONGO_URL || 'mongodb+srv://poweruniverse444:fJOFXsrWuAJ6l0Cn@cluster0.g5j2n.mongodb.net/trade?retryWrites=true&w=majority&appName=Cluster0',
  REDIS_PORT: process.env.REDIS_PORT || 10044,
  REDIS_HOST: process.env.REDIS_HOST || 'redis-10044.c212.ap-south-1-1.ec2.redns.redis-cloud.com',
  REDIS_PASS: process.env.REDIS_PASS || 'EEu0XLr3znrmN6EAO5ybE9rNSXT9WOfe',
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_ADMIN_SECRET: process.env.JWT_ADMIN_SECRET,
  JWT_VALIDITY: process.env.JWT_VALIDITY || '10d',
  LOGIN_HARD_LIMIT_ADMIN: process.env.LOGIN_HARD_LIMIT_ADMIN || 3,
  LOGIN_ID: process.env.loginId || 'DC-NIRM5844',
  PRODUCT: process.env.product || 'DIRECTRTLITE',
  API_KEY: process.env.apiKey || '1732E0482ECA4255B8A6'
}
module.exports = environment
