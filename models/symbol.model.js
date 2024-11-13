const mongoose = require('mongoose')
const Schema = mongoose.Schema
const { DBconnected } = require('./db/mongodb')

const symbolSchema = new Schema({
  exchange: {
    type: String,
    enum: ['NSE', 'MCX'], // Limit to NSE and MCX
    required: true
  },
  type: {
    type: Array,
    default: ['OPTCOM', 'OPTSTK', 'FUTCOM', 'FUTSTK']
  },
  symbol: {
    type: String,
    required: true,
    trim: true
  },
  key: {
    type: String,
    default: ''
  },
  active: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true // Adds createdAt and updatedAt timestamps
})

const symbol = DBconnected.model('symbol', symbolSchema)

module.exports = symbol
