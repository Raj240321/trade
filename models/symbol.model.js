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
    enum: ['FUTCOM', 'FUTSTK'],
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
  openPrice: {
    type: Number,
    default: 0
  },
  highPrice: {
    type: Number,
    default: 0
  },
  lowPrice: {
    type: Number,
    default: 0
  },
  closePrice: {
    type: Number,
    default: 0
  },
  prevClose: {
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
  marketLot: {
    type: Number,
    default: 0
  },
  bestBuy: {
    type: Number,
    default: 0
  },
  bestSell: {
    type: Number,
    default: 0
  },
  settlementPrice: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true // Adds createdAt and updatedAt timestamps
})

const symbol = DBconnected.model('symbol', symbolSchema)

module.exports = symbol
