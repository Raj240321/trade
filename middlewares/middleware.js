const { validationResult } = require('express-validator')
const config = require('../config/config')
const jwt = require('jsonwebtoken')
const { ObjectId } = require('mongoose').Types
const { redisClient } = require('../helper/redis')

const validateAdmin = async (req, res, next) => {
  try {
    // Retrieve the token from the request header
    let token = req.header('Authorization')

    // Check if the token is present
    if (!token) {
      return res.status(401).jsonp({
        status: 401,
        message: 'Authentication failed. Please login again!'
      })
    }
    token = token.split(' ')[1]
    const isBlackList = await redisClient.get(`BlackListToken:${token}`)
    if (isBlackList) {
      return res.status(401).jsonp({
        status: 401,
        message: 'Authentication failed. Please login again!'
      })
    }
    req.admin = {}
    let admin
    try {
      // Verify the JWT token using the secret key for admin authentication
      admin = jwt.verify(token, config.JWT_ADMIN_SECRET)
    } catch (err) {
      return res.status(401).jsonp({
        status: 401,
        message: 'Authentication failed. Please login again!'
      })
    }

    // Check if admin object is obtained from the JWT token
    if (!admin) {
      return res.status(401).jsonp({
        status: 401,
        message: 'Authentication failed. Please login again!'
      })
    }
    // Set authenticated admin in the request object
    req.admin = admin
    req.admin.id = new ObjectId(admin.id)
    req.admin.role = admin.role
    req.admin.isTrade = admin.isTrade
    req.admin.code = admin.code
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(422).jsonp({
        status: 422,
        errors: errors.array()
      })
    }
    return next()
  } catch (error) {
    console.log('***************validateAdmin*************', error)
    // Handle errors, log them, and send an internal server error response
    return res.status(500).jsonp({
      status: 500,
      message: 'something went wrong.'
    })
  }
}

const isSuperMaster = async (req, res, next) => {
  try {
    if (req.admin.role !== 'superMaster') {
      return res.status(401).jsonp({
        status: 401,
        message: 'Permission denied'
      })
    }
    return next()
  } catch (error) {
    console.log('***************isSuper*************', error)
    // Handle errors, log them, and send an internal server error response
    return res.status(500).jsonp({
      status: 500,
      message: 'something went wrong.'
    })
  }
}

const isUserSocketAuthenticated = async (socket, next) => {
  try {
    const { loginId, sessionToken, product } = socket.handshake.query

    // Validate required parameters
    if (!loginId || !sessionToken) {
      console.log('Missing authentication parameters')
      return unauthorized(socket, next)
    }

    if (config.SOCKET_LOGIN_ID !== loginId || config.SOCKET_TOKEN !== sessionToken || product !== config.SOCKET_PRODUCT) {
      console.log('Invalid login id')
      return unauthorized(socket, next)
    }

    // Authentication successful, proceed with the connection
    console.log(`User authenticated: ${loginId}`)
    next()
  } catch (error) {
    console.error('Authentication error:', error)
    return unauthorized(socket, next)
  }
}

// Helper function to handle unauthorized access
const unauthorized = (socket, next) => {
  socket.emit('unauthorized', { message: 'unauthorized' }, () => {
    socket.disconnect()
  })
  next(new Error('unauthorized'))
}

module.exports = {
  validateAdmin,
  isSuperMaster,
  isUserSocketAuthenticated
}
