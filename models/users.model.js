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
  nProfit: { type: Number, default: 0 },
  loginAt: { type: Date, default: null },
  highToLow: { type: Boolean, default: false },
  intraDay: { type: Boolean, default: false },
  m2mLinkLedger: { type: Boolean, default: false },
  bandScript: { type: Boolean, default: false },
  HR3sqOff: { type: Boolean, default: false },
  autoSquare: { type: Boolean, default: false },
  positionSquareOff: { type: Boolean, default: false },
  viewAccess: { type: Boolean, default: false },
  btEnabled: { type: Boolean, default: false },
  sqOfDisableMinutes: { type: Number, default: 0 },
  orderLimit: { type: Number, default: 0, max: 100 },
  alert: { type: Number, default: 0, max: 100 },
  m2mProfit: { type: Number, default: 0 },
  m2mLoss: { type: Number, default: 0 },
  marketAccess: { type: Array, default: ['NSE', 'BSE'] },
  userNotes: { type: String, default: '' },
  noOfBrokers: { type: Number, default: 0 },
  ledgerView: { type: Boolean, default: true }
}, { timestamps: true })

userSchema.index({ role: 1, isActive: 1 })

const Users = DBconnected.model('users', userSchema)
module.exports = Users
