const mongoose = require('mongoose')
const Schema = mongoose.Schema
const { DBconnected } = require('./db/mongodb')

const stockSchema = new Schema({
  exchange: {
    type: String,
    enum: ['NSE', 'MCX'], // Limit to NSE and MCX
    required: true
  },
  type: {
    type: String,
    enum: ['OPTCOM', 'OPTSTK', 'FUTCOM', 'FUTSTK'], // Only common types for NSE and MCX
    required: true
  },
  commodity: {
    type: String,
    required: true,
    trim: true
  },
  expiryDate: {
    type: Date,
    required: true
  },
  expiryDateInString: {
    type: String,
    required: true,
    trim: true
  },
  strikePrice: {
    type: Number,
    required: true,
    min: [1, 'Strike price must be a positive number.']
  },
  optionType: {
    type: String,
    enum: ['CE', 'PE'], // Limit to Call and Put
    required: true
  },
  additionalData: {
    type: Map,
    of: mongoose.Schema.Types.Mixed, // Flexibility to store any additional data
    default: {}
  },
  key: {
    type: String,
    required: true,
    unique: true
  },
  active: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true // Adds createdAt and updatedAt timestamps
})

// Adding indexes for improved query performance
stockSchema.index({ key: 1 })
stockSchema.index({ exchange: 1, expiryDate: 1 })
stockSchema.index({ type: 1, commodity: 1, expiryDate: 1 })

// Compile model from schema
const Stock = DBconnected.model('Stock', stockSchema)

module.exports = Stock
