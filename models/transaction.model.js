const mongoose = require('mongoose')
const { DBconnected } = require('./db/mongodb')
const { v4: uuidv4 } = require('uuid')

const transactionSchema = new mongoose.Schema(
  {
    superMasterId: { type: mongoose.Schema.Types.ObjectId, ref: 'users', index: true },
    masterId: { type: mongoose.Schema.Types.ObjectId, ref: 'users', index: true },
    brokerId: { type: mongoose.Schema.Types.ObjectId, ref: 'users', index: true },
    code: { type: String, required: true },
    actionOn: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true },
    actionBy: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true },
    actionName: { type: String, required: true },
    type: { type: String, required: true },
    transactionId: { type: String, default: uuidv4, unique: true }, // Auto-generate UUID if not provided
    transactionStatus: { type: String, enum: ['SUCCESS', 'FAILED', 'PENDING'], default: 'PENDING' },
    beforeBalance: { type: Number, required: true, default: 0 },
    amount: { type: Number, required: true, min: 0 },
    afterBalance: { type: Number, required: true, default: 0 },
    responseCode: { type: String },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
)

// Pre-save hook to auto-generate a UUID for transactionId if not provided
transactionSchema.pre('save', function (next) {
  if (!this.transactionId) {
    this.transactionId = uuidv4()
  }
  next()
})

const transaction = DBconnected.model('transactions', transactionSchema)
module.exports = transaction
