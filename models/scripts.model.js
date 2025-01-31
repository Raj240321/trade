const mongoose = require('mongoose')
const Schema = mongoose.Schema
const { DBconnected } = require('./db/mongodb')

const watchListSchema = new Schema({
  exchange: {
    type: String,
    enum: ['NSE', 'MCX'], // Limit to NSE and MCX
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  type: {
    type: String,
    enum: ['FUTCOM', 'FUTSTK', 'INDICES', 'FUTIDX'],
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
    default: true
  },
  expiry: {
    type: Date,
    required: true
  },
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'users',
    required: true
  },
  scriptId: {
    type: Schema.Types.ObjectId,
    ref: 'symbol',
    required: true
  },
  marketLot: {
    type: Number,
    required: true
  },
  quantity: {
    type: Number,
    default: 0
  },
  avgPrice: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true // Adds createdAt and updatedAt timestamps
})

watchListSchema.index({ userId: 1, key: 1 }, { unique: true })
watchListSchema.index({ userId: 1, symbol: 1, expiry: 1 })
watchListSchema.index({ userId: 1, active: 1 })
// Compile model from schema
const watchList = DBconnected.model('watchLists', watchListSchema)

module.exports = watchList
