const mongoose = require('mongoose')
const Schema = mongoose.Schema
const { DBconnected } = require('./db/mongodb') // Assuming DBconnected is used for database connection

const tradeLogSchema = new Schema({
  transactionType: {
    type: String,
    enum: ['BUY', 'SELL'],
    required: true
  },
  symbolId: {
    type: Schema.Types.ObjectId,
    ref: 'symbol',
    required: true
  },
  key: {
    type: String,
    default: ''
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  totalValue: {
    type: Number
  },
  executionStatus: {
    type: String,
    enum: ['UPDATED', 'CANCELED'],
    default: 'UPDATED'
  },
  lot: {
    type: Number,
    default: 0
  },
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'users',
    required: true // Ensuring that user is always present
  },
  userIp: {
    type: String,
    default: ''
  },
  updatedBalance: {
    type: Number,
    default: 0
  },
  transactionDate: {
    type: Date,
    default: Date.now
  },
  transactionFee: {
    type: Number,
    default: 0,
    min: 0
  },
  orderType: {
    type: String
  },
  remarks: {
    type: String,
    trim: true
  },
  realizedPnl: {
    type: Number,
    default: 0
  },
  triggeredAt: {
    type: Date,
    default: null
  },
  deletedBy: {
    type: Schema.Types.ObjectId,
    ref: 'users'
  },
  transactionId: {
    type: String
  },
  tradeId: {
    type: Schema.Types.ObjectId,
    ref: 'trades',
    required: true
  }
}, {
  timestamps: true
})

// Model for Stock Transactions
const TradeLog = DBconnected.model('tradeLogs', tradeLogSchema)

module.exports = TradeLog
