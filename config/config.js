require('dotenv').config()
console.log(process.env.NODE_ENV, 'Server Start...')
const environment = {
  PORT: process.env.PORT || 1101,
  NODE_ENV: process.env.NODE_ENV || 'local',
  MONGO_URL: process.env.MONGO_URL || 'mongodb+srv://poweruniverse444:fJOFXsrWuAJ6l0Cn@cluster0.g5j2n.mongodb.net/trade?retryWrites=true&w=majority&appName=Cluster0',
  REDIS_PORT: process.env.REDIS_PORT || 6379,
  REDIS_HOST: process.env.REDIS_HOST || 'localhost',
  REDIS_PASS: process.env.REDIS_PASS || false,
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_ADMIN_SECRET: process.env.JWT_ADMIN_SECRET,
  JWT_VALIDITY: process.env.JWT_VALIDITY || '10d',
  LOGIN_HARD_LIMIT_ADMIN: process.env.LOGIN_HARD_LIMIT_ADMIN || 3
}
module.exports = environment
