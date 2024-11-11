const scriptModel = require('../../models/scripts.model')

class Script {
  // Add a single script with validation
  async addSingle(req, res) {
    try {
      const scriptData = req.body

      // Default strikePrice to 1 if not provided
      if (!scriptData.strikePrice) scriptData.strikePrice = 1
      scriptData.expiryDate = parseCustomDate(scriptData.expiryDateInString)
      // Ensure expiryDate is in the future
      if (new Date(scriptData.expiryDate) <= new Date()) {
        return res.status(400).jsonp({ status: 400, message: 'Expiry date must be in the future.' })
      }

      // Check for existing key
      const existingScript = await scriptModel.findOne({ key: scriptData.key }).lean()
      if (existingScript) {
        return res.status(400).jsonp({ status: 400, message: 'script with this key already exists.' })
      }

      // Create script
      await scriptModel.create(scriptData)
      return res.status(200).jsonp({ status: 200, message: 'script added successfully.' })
    } catch (error) {
      console.log('script.addSingle', error)
      return res.status(500).jsonp({ status: 500, message: 'Something went wrong.' })
    }
  }

  // Add multiple scripts (bulk add) with validation
  async addBulk(req, res) {
    try {
      const scriptDataArray = Array.isArray(req.body.scripts) ? req.body.scripts : [req.body.scripts]
      const validScripts = []
      const errors = []

      for (const scriptData of scriptDataArray) {
        scriptData.strikePrice = scriptData.strikePrice || 1

        // Check expiry date validation
        scriptData.expiryDate = parseCustomDate(scriptData.expiryDateInString)
        if (new Date(scriptData.expiryDate) <= new Date()) {
          errors.push({ key: scriptData.key, message: 'Expiry date must be in the future.' })
          continue
        }

        // Check for existing key
        const existingScript = await scriptModel.findOne({ key: scriptData.key }).lean()
        if (existingScript) {
          errors.push({ key: scriptData.key, message: 'script with this key already exists.' })
          continue
        }

        validScripts.push(scriptData)
      }

      if (validScripts.length > 0) await scriptModel.insertMany(validScripts)

      return res.status(200).jsonp({
        status: 200,
        message: 'Bulk scripts processed.',
        successCount: validScripts.length,
        errorCount: errors.length,
        errors
      })
    } catch (error) {
      console.log('script.addBulk', error)
      return res.status(500).jsonp({ status: 500, message: 'Something went wrong.' })
    }
  }

  // List scripts with pagination and sorting
  async list(req, res) {
    try {
      const {
        page = 1,
        limit = 10,
        search,
        sort = 'createdAt',
        exchange,
        expiryDate,
        type,
        optionType,
        active
      } = req.query

      const query = {}

      if (search) {
        query.commodity = { $regex: new RegExp(search, 'i') }
      }
      if (exchange) query.exchange = exchange
      if (expiryDate) query.expiryDate = new Date(expiryDate)
      if (type) query.type = type
      if (optionType) query.optionType = optionType
      if (active !== undefined) query.active = active === 'true'

      const options = {
        sort: { [sort]: -1 },
        skip: (Number(page) - 1) * Number(limit),
        limit: Number(limit),
        lean: true
      }

      const [results, total] = await Promise.all([
        scriptModel.find(query, null, options),
        scriptModel.countDocuments(query)
      ])

      return res.status(200).json({
        status: 200,
        message: 'Scripts fetched successfully.',
        data: { total, results }
      })
    } catch (error) {
      console.error('script.list', error)
      return res.status(500).json({
        status: 500,
        message: 'Something went wrong.'
      })
    }
  }

  // Get script by ID
  async get(req, res) {
    try {
      const data = await scriptModel.findById(req.params.id).lean()
      if (!data) {
        return res.status(400).jsonp({ status: 400, message: 'script does not exist.' })
      }
      return res.status(200).jsonp({ status: 200, message: 'script fetched successfully.', data })
    } catch (error) {
      console.log('script.get', error)
      return res.status(500).jsonp({ status: 500, message: 'Something went wrong.' })
    }
  }

  // Update script by ID
  async update(req, res) {
    try {
      const scriptData = req.body

      if (!scriptData.strikePrice) scriptData.strikePrice = 1

      if (new Date(scriptData.expiryDate) <= new Date()) {
        return res.status(400).jsonp({ status: 400, message: 'Expiry date must be in the future.' })
      }

      const existingScript = await scriptModel.findOne({ key: scriptData.key, _id: { $ne: req.params.id } }).lean()
      if (existingScript) {
        return res.status(400).jsonp({ status: 400, message: 'script with this key already exists.' })
      }

      const updatedScript = await scriptModel.findByIdAndUpdate(req.params.id, scriptData, { new: true, runValidators: true }).lean()
      if (!updatedScript) {
        return res.status(400).jsonp({ status: 400, message: 'script does not exist.' })
      }

      return res.status(200).jsonp({ status: 200, message: 'script updated successfully.' })
    } catch (error) {
      console.log('script.update', error)
      return res.status(500).jsonp({ status: 500, message: 'Something went wrong.' })
    }
  }

  // Delete script by ID
  async delete(req, res) {
    try {
      const deletedScript = await scriptModel.findByIdAndDelete(req.params.id).lean()
      if (!deletedScript) {
        return res.status(400).jsonp({ status: 400, message: 'script does not exist.' })
      }
      return res.status(200).jsonp({ status: 200, message: 'script deleted successfully.' })
    } catch (error) {
      console.log('script.delete', error)
      return res.status(500).jsonp({ status: 500, message: 'Something went wrong.' })
    }
  }
}

module.exports = new Script()

function parseCustomDate(dateString) {
// Define month abbreviations
  const months = {
    JAN: 0,
    FEB: 1,
    MAR: 2,
    APR: 3,
    MAY: 4,
    JUN: 5,
    JUL: 6,
    AUG: 7,
    SEP: 8,
    OCT: 9,
    NOV: 10,
    DEC: 11
  }
  // Extract the day, month, and year from the string
  const day = parseInt(dateString.slice(0, 2), 10)
  const monthStr = dateString.slice(2, 5).toUpperCase() // Get the month part as a string
  const year = parseInt(dateString.slice(5), 10) // Get the year
  // Get the month index from the months object
  const month = months[monthStr]

  if (isNaN(day) || isNaN(month) || isNaN(year)) {
    throw new Error('Invalid date format')
  }
  return new Date(year, month, day)
}
