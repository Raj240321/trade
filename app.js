const express = require('express')
const app = express()
const config = require('./config/config')
const server = require('http').createServer(app)
const io = require('socket.io')(server, {
  pingInterval: 10000,
  pingTimeout: 8000,
  maxHttpBufferSize: 1e8,
  allowUpgrades: true,
  perMessageDeflate: false,
  serveClient: true,
  cookie: false,
  transports: ['websocket'],
  connectTimeout: 45000,
  allowEIO3: true,
  cors: {
    origin: '*:*',
    methods: ['GET', 'POST'],
    credentials: false
  }
})

global.appRootPath = __dirname

require('./models/db/mongodb.js')

require('./middlewares/index')(app)

require('./middlewares/routes')(app)

require('./socket')(io)

server.listen(config.PORT, () => {
  console.log('Trade true on port : ' + config.PORT)
})
