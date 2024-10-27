const mongoose = require('mongoose')
const { role } = require('../enum')
const { DBconnected } = require('./db/mongodb')

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  code: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, required: true, enum: role, default: 'master' },
  balance: { type: Number, default: 0 },
  balanceLimit: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  isTrade: { type: Boolean, default: true },
  superMasterId: { type: mongoose.Schema.Types.ObjectId, ref: 'users' },
  masterId: { type: mongoose.Schema.Types.ObjectId, ref: 'users' },
  brokerId: { type: mongoose.Schema.Types.ObjectId, ref: 'users' },
  createCount: { type: Number, default: 0 },
  createLimit: { type: Number, default: 0 },
  isAdmin: { type: Boolean, default: false },
  jwtTokens: [{
    token: { type: String },
    timeStamp: { type: Date, default: Date.now }
  }],
  loginAt: { type: Date, default: null }
}, { timestamps: true })

const Users = DBconnected.model('users', userSchema)
module.exports = Users
