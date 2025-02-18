const QuantityModel = require('../../models/quantity.model')
const mongoose = require('mongoose')
const ObjectId = mongoose.Types.ObjectId

class QuantityService {
  // Create Quantity with Duplicate Handling
  async createQuantity(req, res) {
    try {
      const { minQuantity, maxQuantity, maxPosition, qtyRangeStart, qtyRangeEnd, type, scriptType, exchange } = req.body

      // Insert new quantity
      const data = await QuantityModel.create({
        minQuantity,
        maxQuantity,
        maxPosition,
        qtyRangeStart,
        qtyRangeEnd,
        type,
        scriptType,
        exchange
      })

      return res.status(200).json({ status: 200, message: 'Quantity added successfully.', data })
    } catch (error) {
      console.error('QuantityService.createQuantity', error)
      return res.status(500).json({ status: 500, message: 'Something went wrong.' })
    }
  }

  // Update Quantity with Duplicate Handling
  async updateQuantity(req, res) {
    try {
      const { id } = req.params
      const { minQuantity, maxQuantity, maxPosition, qtyRangeStart, qtyRangeEnd, type, scriptType, exchange } = req.body

      // Check if quantity exists
      const existingQuantity = await QuantityModel.findById(id)
      if (!existingQuantity) {
        return res.status(404).json({ status: 404, message: 'Quantity not found.' })
      }

      // Update the quantity
      const updatedQuantity = await QuantityModel.findOneAndUpdate(
        { _id: ObjectId(id) },
        { minQuantity, maxQuantity, maxPosition, qtyRangeStart, qtyRangeEnd, type, scriptType, exchange },
        { new: true }
      )

      return res.status(200).json({ status: 200, message: 'Quantity updated successfully.', data: updatedQuantity })
    } catch (error) {
      console.error('QuantityService.updateQuantity', error)
      return res.status(500).json({ status: 500, message: 'Something went wrong.' })
    }
  }

  // Delete Quantity
  async deleteQuantity(req, res) {
    try {
      const { id } = req.params
      const quantity = await QuantityModel.findByIdAndDelete(id)
      if (!quantity) {
        return res.status(404).json({ status: 404, message: 'Quantity not found.' })
      }
      return res.status(200).json({ status: 200, message: 'Quantity deleted successfully.' })
    } catch (error) {
      console.error('QuantityService.deleteQuantity', error)
      return res.status(500).json({ status: 500, message: 'Something went wrong.' })
    }
  }

  // Get Single Quantity
  async getSingleQuantity(req, res) {
    try {
      const { id } = req.params

      const quantity = await QuantityModel.findById(id)
      if (!quantity) {
        return res.status(404).json({ status: 404, message: 'Quantity not found.' })
      }

      return res.status(200).json({ status: 200, data: quantity })
    } catch (error) {
      console.error('QuantityService.getSingleQuantity', error)
      return res.status(500).json({ status: 500, message: 'Something went wrong.' })
    }
  }

  // Get All Quantities (Grouped by Script Type)
  async getAllQuantities(req, res) {
    try {
      const quantities = await QuantityModel.find().sort({ scriptType: 1, qtyRangeStart: 1 })
      return res.status(200).json({ status: 200, data: quantities })
    } catch (error) {
      console.error('QuantityService.getAllQuantities', error)
      return res.status(500).json({ status: 500, message: 'Something went wrong.' })
    }
  }
}

module.exports = new QuantityService()

async function defaultQuantity() {
  try {
    const totalRecords = await QuantityModel.countDocuments()
    if (totalRecords) {
      return true
    }
    const obj = [
      {
        minQuantity: 1,
        maxQuantity: 500,
        maxPosition: 1000,
        qtyRangeStart: 1,
        qtyRangeEnd: 500,
        type: 'QTY',
        scriptType: 'ALL',
        exchange: 'NSE'
      },
      {
        minQuantity: 1,
        maxQuantity: 400,
        maxPosition: 700,
        qtyRangeStart: 501,
        qtyRangeEnd: 1000,
        type: 'QTY',
        scriptType: 'ALL',
        exchange: 'NSE'
      },
      {
        minQuantity: 1,
        maxQuantity: 300,
        maxPosition: 400,
        qtyRangeStart: 1001,
        qtyRangeEnd: 2000,
        type: 'QTY',
        scriptType: 'ALL',
        exchange: 'NSE'
      },
      {
        minQuantity: 1,
        maxQuantity: 100,
        maxPosition: 200,
        qtyRangeStart: 2001,
        qtyRangeEnd: 5000,
        type: 'QTY',
        scriptType: 'ALL',
        exchange: 'NSE'
      },
      {
        minQuantity: 1,
        maxQuantity: 5,
        maxPosition: 10,
        qtyRangeStart: 5001,
        qtyRangeEnd: 100000,
        type: 'QTY',
        scriptType: 'ALL',
        exchange: 'NSE'
      },
      {
        minQuantity: 1,
        maxQuantity: 50,
        maxPosition: 100,
        qtyRangeStart: 0,
        qtyRangeEnd: 0,
        type: 'QTY',
        scriptType: 'NIFTY',
        exchange: 'NSE'
      },
      {
        minQuantity: 1,
        maxQuantity: 25,
        maxPosition: 50,
        qtyRangeStart: 0,
        qtyRangeEnd: 0,
        type: 'QTY',
        scriptType: 'BANKNIFTY',
        exchange: 'NSE'
      }
    ]
    await QuantityModel.insertMany(obj)
    return true
  } catch (error) {
    console.log('*********defaultQuantity**********', error)
    return false
  }
}
defaultQuantity()
