const mongoose = require('mongoose')
const Schema = mongoose.Schema
const { DBconnected } = require('./db/mongodb')

const Quantity = new Schema({
  minQuantity: { type: Number },
  maxQuantity: { type: Number },
  maxPosition: { type: Number },
  qtyRangeEnd: { type: Number, default: 0 },
  qtyRangeStart: { type: Number, default: 0 },
  type: { type: String, enum: ['QTY', 'PRICE'], default: 'QTY' },
  scriptType: { type: String, enum: ['ALL', 'NIFTY', 'BANKNIFTY'], default: 'ALL' },
  exchange: {
    type: String,
    enum: ['NSE', 'MCX', 'BSE'], // Limiting exchanges to NSE and MCX
    required: true
  }
}, { timestamps: true })

module.exports = DBconnected.model('quantities', Quantity)
