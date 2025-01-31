const mongoose = require('mongoose')
const Schema = mongoose.Schema
const { DBconnected } = require('./db/mongodb')

const symbolSchema = new Schema({
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
  identifier: {
    type: String,
    default: ''
  },
  Open: {
    type: Number,
    default: 0
  },
  High: {
    type: Number,
    default: 0
  },
  Low: {
    type: Number,
    default: 0
  },
  closePrice: {
    type: Number,
    default: 0
  },
  PrevClose: {
    type: Number,
    default: 0
  },
  lastPrice: {
    type: Number,
    default: 0
  },
  change: {
    type: Number,
    default: 0
  },
  pChange: {
    type: Number,
    default: 0
  },
  BSQ: {
    type: Number,
    default: 0
  },
  BBQ: {
    type: Number,
    default: 0
  },
  StrikePrice: {
    type: Number,
    default: 0
  },
  BBP: {
    type: Number,
    default: 0
  },
  BSP: {
    type: Number,
    default: 0
  },
  settlementPrice: {
    type: Number,
    default: 0
  },
  DayHighest: {
    type: Number,
    default: 0
  },
  DayLowest: {
    type: Number,
    default: 0
  },
  DayOpen: {
    type: Number,
    default: 0
  },
  ATP: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true // Adds createdAt and updatedAt timestamps
})

const symbol = DBconnected.model('symbol', symbolSchema)

module.exports = symbol
