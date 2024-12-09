const mongoose = require('mongoose')
const Schema = mongoose.Schema
const { DBconnected } = require('./db/mongodb') // Assuming DBconnected is used for database connection

const tradeSchema = new Schema({
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
    type: Number,
    required: true,
    default: function () {
      return this.quantity && this.price ? this.quantity * this.price : 0
    }
  },
  executionStatus: {
    type: String,
    enum: ['PENDING', 'EXECUTED', 'CANCELLED', 'REJECTED'],
    default: 'PENDING'
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
    type: String,
    enum: ['MARKET', 'LIMIT', 'STOP-LOSS'],
    default: 'MARKET'
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
  transactionId: {
    type: String,
    default: function () {
      return new mongoose.Types.ObjectId().toString()
    },
    unique: true
  }
}, {
  timestamps: true
})

// Model for Stock Transactions
const StockTransaction = DBconnected.model('trades', tradeSchema)

module.exports = StockTransaction
