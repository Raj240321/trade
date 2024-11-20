const mongoose = require('mongoose')
const Schema = mongoose.Schema
const { DBconnected } = require('./db/mongodb')

const positionSchema = new Schema({
  exchange: {
    type: String,
    enum: ['NSE', 'MCX'], // Limiting exchanges to NSE and MCX
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  type: {
    type: String,
    enum: ['FUTCOM', 'FUTSTK'], // Differentiates between futures commodity and futures stock
    required: true
  },
  symbol: {
    type: String,
    required: true,
    trim: true
  },
  key: {
    type: String,
    required: true
  },
  active: {
    type: Boolean,
    default: true // Indicates whether the position is active or closed
  },
  expiry: {
    type: Date,
    required: true // Required for future-based positions
  },
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'users',
    required: true // Tracks which user owns this position
  },
  symbolId: {
    type: Schema.Types.ObjectId,
    ref: 'symbol',
    required: true // Reference to the symbol this position is for
  },
  marketLot: {
    type: Number,
    required: true // The number of units per contract in market
  },
  quantity: {
    type: Number,
    default: 0, // Current quantity in the position (can be positive or negative for buy/sell)
    min: 0 // Ensures quantity doesn't go negative unless selling
  },
  avgPrice: {
    type: Number,
    default: 0, // Average price at which the user has bought the position
    min: 0
  },
  openDate: {
    type: Date,
    default: Date.now // The date when the position was first opened
  },
  closeDate: {
    type: Date,
    default: null // The date when the position was closed
  },
  realizedPnl: {
    type: Number,
    default: 0, // Realized profit/loss after position closure
    min: 0
  },
  unrealizedPnl: {
    type: Number,
    default: 0, // Unrealized profit/loss for an active position
    min: 0
  },
  stopLossPrice: {
    type: Number,
    min: 0, // The stop-loss price, applicable to sell orders
    default: 0
  },
  targetPrice: {
    type: Number,
    min: 0, // Target price for taking profit
    default: 0
  },
  status: {
    type: String,
    enum: ['OPEN', 'CLOSED'],
    default: 'OPEN' // Status of the position: open or closed
  },
  lot: {
    type: Number,
    default: 1 // Status of the position: open or closed
  },
  transactionReferences: {
    type: Schema.Types.ObjectId,
    ref: 'trades' // References to the related trades (buy or sell) for auditing purposes
  }
}, {
  timestamps: true // Adds createdAt and updatedAt timestamps
})

// Compile model from schema
const Position = DBconnected.model('position', positionSchema)

module.exports = Position
