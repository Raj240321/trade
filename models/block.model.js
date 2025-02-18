const mongoose = require('mongoose')
const Schema = mongoose.Schema
const { DBconnected } = require('./db/mongodb')

const blockListSchema = new Schema({
  exchange: {
    type: String,
    enum: ['NSE', 'MCX', 'BSE'], // Limit to NSE and MCX
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
  expiry: {
    type: Date,
    required: true
  },
  masterId: {
    type: Schema.Types.ObjectId,
    ref: 'users'
  },
  brokersId: [{
    type: Schema.Types.ObjectId,
    ref: 'users'
  }],
  usersId: [{
    type: Schema.Types.ObjectId,
    ref: 'users'
  }],
  scriptId: {
    type: Schema.Types.ObjectId,
    ref: 'symbol',
    required: true
  },
  blockBy: {
    type: Schema.Types.ObjectId,
    ref: 'users',
    required: true
  },
  blockOn: {
    type: Schema.Types.ObjectId,
    ref: 'users',
    required: true
  },
  blockAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true // Adds createdAt and updatedAt timestamps
})

// Compile model from schema
const blockList = DBconnected.model('blockLists', blockListSchema)

module.exports = blockList
