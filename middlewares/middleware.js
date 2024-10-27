const { validationResult } = require('express-validator')
const config = require('../config/config')
const jwt = require('jsonwebtoken')
const { ObjectId } = require('mongoose').Types
const { redisClient } = require('../helper/redis')

const validateAdmin = async (req, res, next) => {
  try {
    // Retrieve the token from the request header
    const token = req.header('Authorization')

    // Check if the token is present
    if (!token) {
      return res.status(401).jsonp({
        status: 401,
        message: 'Authentication failed. Please login again!'
      })
    }
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

module.exports = {
  validateAdmin,
  isSuperMaster
}
