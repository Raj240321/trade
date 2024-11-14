const symbolModel = require('../../models/symbol.model')

class Symbol {
  async createSymbol(req, res) {
    try {
      let { symbol, exchange, expiry = '', day = 4 } = req.body
      symbol = symbol.toUpperCase()
      exchange = exchange.toUpperCase()

      const type = exchange === 'NSE' ? 'FUTSTK' : 'FUTCOM'
      const allExpiry = []
      if (expiry === '') {
        expiry = getLastDay(day)
        allExpiry.push(...expiry)
      }

      // Process single expiry or multiple expiry
      if (allExpiry.length > 0) {
        for (const eachExpiry of allExpiry) {
          const formattedExpiry = convertToDateFormat(eachExpiry)
          const existingSymbol = await symbolModel.findOne({ symbol, exchange, expiry: eachExpiry }).lean()
          if (existingSymbol) {
            // Symbol already exists, skip creation
            continue
          }

          // Convert expiry date format
          const stringExpiry = formatExpiryDate(formattedExpiry)
          // Generate key and name
          const key = `${exchange}_${type}_${symbol}_${stringExpiry}`
          const name = `${symbol} ${stringExpiry}`

          // Create and save new symbol document
          await symbolModel.create({ type, symbol, exchange, expiry: eachExpiry, key, name })
        }
      } else {
        const existingSymbol = await symbolModel.findOne({ symbol, exchange, expiry }).lean()
        if (existingSymbol) {
          return res.status(400).json({ status: 400, message: 'Symbol already exists.' })
        }

        // Convert expiry date format
        const formattedExpiry = formatExpiryDate(expiry)
        // Generate key and name
        const key = `${exchange}_${type}_${symbol}_${formattedExpiry}`
        const name = `${symbol} ${formattedExpiry}`

        // Create and save new symbol document
        await symbolModel.create({ type, symbol, exchange, expiry: formattedExpiry, key, name })
      }

      return res.status(200).json({ status: 200, message: 'Symbol added successfully.' })
    } catch (error) {
      console.error('symbol.create', error)
      return res.status(500).json({ status: 500, message: 'Something went wrong.' })
    }
  }

  async bulkCreateSymbol(req, res) {
    try {
      // Destructure and standardize input fields
      let { symbols, exchange, expiry = '', day = 4 } = req.body
      exchange = exchange.toUpperCase()
      const type = exchange === 'NSE' ? 'FUTSTK' : 'FUTCOM'
      const allExpiry = []
      if (expiry === '') {
        expiry = getLastDay(day)
        allExpiry.push(...expiry)
      }
      const bulkOperations = []
      if (allExpiry.length > 0) {
        for (const eachExpiry of allExpiry) {
          const formattedExpiry = convertToDateFormat(eachExpiry)
          for (const symbol of symbols) {
            const existingSymbol = await symbolModel.findOne({ symbol: symbol.toUpperCase(), exchange, expiry: eachExpiry }).lean()
            if (existingSymbol) {
              // Symbol already exists, skip creation
              continue
            }

            // Convert expiry date format
            const stringExpiry = formatExpiryDate(formattedExpiry)
            // Generate key and name
            const key = `${exchange}_${type}_${symbol.toUpperCase()}_${stringExpiry}`
            const name = `${symbol.toUpperCase()} ${stringExpiry}`

            // Create and save new symbol document
            bulkOperations.push({
              insertOne: {
                document: { type, symbol: symbol.toUpperCase(), exchange, expiry: eachExpiry, key, name }
              }
            })
          }
        }
      } else {
        for (const symbol of symbols) {
          const existingSymbol = await symbolModel.findOne({ symbol: symbol.toUpperCase(), exchange, expiry }).lean()
          if (existingSymbol) {
            continue
          }
          // Convert expiry date format
          const formattedExpiry = formatExpiryDate(expiry)
          // Generate key and name
          const key = `${exchange}_${type}_${symbol.toUpperCase()}_${formattedExpiry}`
          const name = `${symbol.toUpperCase()} ${formattedExpiry}`

          // Create and save new symbol document
          bulkOperations.push({
            insertOne: {
              document: { type, symbol: symbol.toUpperCase(), exchange, expiry: formattedExpiry, key, name }
            }
          })
        }
      }
      if (bulkOperations.length > 0) {
        await symbolModel.bulkWrite(bulkOperations)
      }
      return res.status(200).json({ status: 200, message: 'Symbol added successfully.' })
    } catch (error) {
      console.error('symbol.bulkCreate', error)
      return res.status(500).json({ status: 500, message: 'Something went wrong.' })
    }
  }

  async listSymbol(req, res) {
    try {
      const { role } = req.admin
      const { page = 1, limit = 10, search, exchange, type, active = '' } = req.query
      const query = {}
      const projection = {}
      if (search) {
        query.name = { $regex: new RegExp(search, 'i') }
      }

      if (exchange) query.exchange = exchange.toUpperCase()
      if (type) query.type = type.toUpperCase()
      if (role === 'superMaster') {
        if (active !== '') query.active = active
      } else {
        query.active = true
        projection.active = 0
        projection.createdAt = 0
        projection.updatedAt = 0
        projection.__v = 0
      }
      const results = await symbolModel.find(query, projection).sort({ symbol: 1 }).skip((Number(page) - 1) * limit).limit(Number(limit)).lean()
      const total = await symbolModel.countDocuments({ ...query })
      const data = { total, results }
      return res.status(200).jsonp({ status: 200, message: 'symbol fetch successfully.', data })
    } catch (error) {
      console.error('symbol.list', error)
      return res.status(500).jsonp({ status: 500, message: 'something went wrong.' })
    }
  }

  async updateSymbol(req, res) {
    try {
      let { symbol, exchange, type } = req.body
      symbol = symbol.toUpperCase()
      exchange = exchange.toUpperCase()
      const exist = await symbolModel.findOne({ symbol, exchange, type, _id: { $ne: req.params.id } }).lean()
      if (exist) {
        return res.status(400).jsonp({ status: 400, message: 'symbol already exists.' })
      }
      await symbolModel.findByIdAndUpdate(req.params.id, { ...req.body })
      return res.status(200).jsonp({ status: 200, message: 'symbol updated successfully.' })
    } catch (error) {
      console.error('symbol.update', error)
      return res.status(500).jsonp({ status: 500, message: 'something went wrong.' })
    }
  }

  async deleteSymbol(req, res) {
    try {
      await symbolModel.findByIdAndDelete(req.params.id)
      return res.status(200).jsonp({ status: 200, message: 'symbol deleted successfully.' })
    } catch (error) {
      console.error('symbol.delete', error)
      return res.status(500).jsonp({ status: 500, message: 'something went wrong.' })
    }
  }

  async getSymbol(req, res) {
    try {
      const { role } = req.admin
      const projection = {}
      if (role !== 'superMaster') {
        projection.active = 0
        projection.createdAt = 0
        projection.updatedAt = 0
        projection.key = 0
        projection.__v = 0
      }
      const data = await symbolModel.findById(req.params.id, projection).lean()
      if (!data) {
        return res.status(400).jsonp({ status: 400, message: 'symbol does not exist.' })
      }
      return res.status(200).jsonp({ status: 200, message: 'symbol fetch successfully.', data })
    } catch (error) {
      console.error('symbol.get', error)
      return res.status(500).jsonp({ status: 500, message: 'something went wrong.' })
    }
  }
}

module.exports = new Symbol()

function formatExpiryDate(expiry) {
  const [year, month, day] = expiry.split('/')
  const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
  return `${day}${monthNames[parseInt(month, 10) - 1]}${year}`
}

function getLastDay(day) {
  const today = new Date()
  const lastThursdays = []

  const findLastThursday = (year, month) => {
    const lastDay = new Date(year, month + 1, 0)
    while (lastDay.getDay() !== day) {
      lastDay.setDate(lastDay.getDate() - 1)
    }
    return lastDay
  }

  const currentMonthLastThursday = findLastThursday(today.getFullYear(), today.getMonth())
  if (today <= currentMonthLastThursday) {
    lastThursdays.push(currentMonthLastThursday)
  }

  for (let i = 1; i <= 2; i++) {
    const futureMonthLastThursday = findLastThursday(today.getFullYear(), today.getMonth() + i)
    lastThursdays.push(futureMonthLastThursday)
  }
  return lastThursdays
}

const convertToDateFormat = (date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}/${month}/${day}`
}
