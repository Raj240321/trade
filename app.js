const express = require('express')
const app = express()
const config = require('./config/config')

global.appRootPath = __dirname

require('./models/db/mongodb.js')

require('./middlewares/index')(app)

require('./middlewares/routes')(app)

app.listen(config.PORT, () => {
  console.log('Trade true on port : ' + config.PORT)
})
