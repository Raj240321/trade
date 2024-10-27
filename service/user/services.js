const UserModel = require('../../models/user.model.js')
const mongoose = require('mongoose')
const ObjectId = mongoose.Types.ObjectId
const { randomInt } = require('crypto')
const jwt = require('jsonwebtoken')
const config = require('../../config/config.js')
const { queuePush } = require('../../helper/redis.js')

class User {
  async createUser(req, res) {
    try {
      const { sName = '', sEmail = '', sMobNum = '' } = req.body
      const query = sEmail !== '' ? { sEmail: sEmail } : { sMobNum: sMobNum }
      const checkUserExists = await UserModel.exists(query)
      if (checkUserExists) {
        return res.status(400).jsonp({
          status: 400,
          message: 'User already exists.'
        })
      }

      const sProPic = userDetails.aProPic[randomBetween(0, userDetails.aProPic.length - 1)]
      const user = await UserModel.create({ sName, sProPic, sEmail, sMobNum })
      const newToken = {
        sToken: jwt.sign({ _id: (user._id).toHexString(), eStatus: 'y' }, config.JWT_SECRET, { expiresIn: config.JWT_VALIDITY })
      }

      user.aJwtTokens.push(newToken)
      const otp = randomBetween(1000, 9999)
      sEmail !== '' ? queuePush('sendMail', { sEmail, otp }) : queuePush('sendOtp', { sMobNum: sMobNum, otp })
      // Add logic of Otp sent.
      return res.status(202).jsonp({
        status: 202,
        message: 'Otp sent successfully on your registered account.'
      })
    } catch (error) {
      console.log('User.createUser', error)
      return res.status(500).jsonp({
        status: 500,
        message: 'Something went wrong!!'
      })
    }
  }

  async getUser(req, res) {
    try {
      const { _id } = req.user
      const user = await UserModel.findOne({ _id: ObjectId(_id), eStatus: 'y' }, { aJwtTokens: 0, oSocial: 0, aDeviceToken: 0, eStatus: 0 }).lean()
      if (user) {
        return res.status(200).jsonp({
          status: 200,
          message: 'User fetched successfully.',
          data: user
        })
      } else {
        return res.status(404).jsonp({
          status: 404,
          message: 'User not found',
          data: {}
        })
      }
    } catch (error) {
      console.log('User.getUser', error)
      return res.status(500).jsonp({
        status: 500,
        message: 'Something went wrong!!'
      })
    }
  }
}

module.exports = new User()

const randomBetween = (min, max) => {
  const num = randomInt(min, max)
  return num
}
