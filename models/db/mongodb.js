const mongoose = require('mongoose')
const config = require('../../config/config')

const DBconnected = connection(config.MONGO_URL, 'Dream')

function connection(DB_URL, DB) {
  try {
    const dbConfig = { readPreference: 'secondaryPreferred' }
    const conn = mongoose.createConnection(DB_URL, dbConfig)
    conn.on('connected', () => console.log(`Connected to ${DB} database.`))
    return conn
  } catch (error) {
    console.log(error)
  }
}
module.exports = {
  DBconnected
}
