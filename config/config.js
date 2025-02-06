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
  LOGIN_ID: process.env.loginId || 'DC-PAWA0985',
  PRODUCT: process.env.product || 'DIRECTRTLITE',
  API_KEY: process.env.apiKey || '86C92290395F481A8CD1',
  ENV_CRYPTO_KEY: process.env.ENV_CRYPTO_KEY || '6d858102402dbbeb0f9bb711e3d13a1229684792db4940db0d0e71c08ca602e1',
  ALGORITHM: process.env.ALGORITHM || 'aes-256-cbc',
  IV_LENGTH: process.env.IV_LENGTH || 16,
  BUY_EXPIRED: process.env.BUY_EXPIRED || 120,
  SOCKET_TOKEN: process.env.SOCKET_TOKEN || 'EEu0XLr3znrmN6EAO5ybE9rNSXT9WOfe',
  SOCKET_PRODUCT: process.env.SOCKET_PRODUCT || 'DIRECTRTLITE',
  SOCKET_LOGIN_ID: process.env.SOCKET_LOGIN_ID || 'DCRAJPRAJAPATI'
}
module.exports = environment
