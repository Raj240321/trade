const mongoose = require('mongoose')
const Schema = mongoose.Schema
const { DBconnected } = require('./db/mongodb')
const { status } = require('../enum')

const Setting = new Schema({
  title: { type: String, required: true },
  key: { type: String, required: true, unique: true },
  max: { type: Number },
  min: { type: Number },
  logo: { type: String },
  position: { type: Number },
  image: { type: String },
  description: { type: String },
  shortName: { type: String, trim: true },
  status: { type: String, enum: status, default: 'y' }, // Y = Active, N = Inactive
  externalId: { type: String },
  value: { type: Number }
}, { timestamps: true })

Setting.index({ title: 1 })
Setting.index({ key: 1 })

module.exports = DBconnected.model('settings', Setting)
