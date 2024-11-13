const symbolModel = require('../../models/symbol.model')

class Symbol {
  async createSymbol(req, res) {
    try {
      let { symbol, exchange } = req.body
      symbol = symbol.toUpperCase()
      exchange = exchange.toUpperCase()
      const exist = await symbolModel.findOne({ symbol, exchange }).lean()
      if (exist) {
        return res.status(400).jsonp({ status: 400, message: 'symbol already exists.' })
      }
      await symbolModel.create({ ...req.body, symbol, exchange })
      return res.status(200).jsonp({ status: 200, message: 'symbol added successfully.' })
    } catch (error) {
      console.log('symbol.create', error)
      return res.status(500).jsonp({ status: 500, message: 'something went wrong.' })
    }
  }

  async bulkCreateSymbol(req, res) {
    try {
      let { symbols, exchange } = req.body
      // first check if any symbols exist if yes then not add give in response.
      console.log('symbols', symbols)
      symbols = symbols.map((symbol) => symbol.toUpperCase())
      exchange = exchange.toUpperCase()
      const existingSymbols = await symbolModel.find({ symbol: { $in: symbols }, exchange }).lean()
      const existingSymbolNames = existingSymbols.map((symbol) => symbol.symbol)
      const nonExistingSymbols = symbols.filter((symbol) => !existingSymbolNames.includes(symbol))
      await symbolModel.insertMany(nonExistingSymbols.map((symbol) => ({ symbol, exchange })))
      return res.status(200).jsonp({ status: 200, message: 'Bulk symbols processed.', existingSymbols, nonExistingSymbols })
    } catch (error) {
      console.log('symbol.bulkCreate', error)
      return res.status(500).jsonp({ status: 500, message: 'something went wrong.' })
    }
  }

  async listSymbol(req, res) {
    try {
      const { role } = req.admin
      const { page = 1, limit = 10, search, exchange, type, active = '' } = req.query
      const query = {}
      const projection = {}
      if (search) {
        query.symbol = { $regex: new RegExp(search, 'i') }
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
        projection.key = 0
        projection.__v = 0
      }
      const results = await symbolModel.find(query, projection).sort({ symbol: 1 }).skip((Number(page) - 1) * limit).limit(Number(limit)).lean()
      const total = await symbolModel.countDocuments({ ...query })
      const data = { total, results }
      return res.status(200).jsonp({ status: 200, message: 'symbol fetch successfully.', data })
    } catch (error) {
      console.log('symbol.list', error)
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
      console.log('symbol.update', error)
      return res.status(500).jsonp({ status: 500, message: 'something went wrong.' })
    }
  }

  async deleteSymbol(req, res) {
    try {
      await symbolModel.findByIdAndDelete(req.params.id)
      return res.status(200).jsonp({ status: 200, message: 'symbol deleted successfully.' })
    } catch (error) {
      console.log('symbol.delete', error)
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
      console.log('symbol.get', error)
      return res.status(500).jsonp({ status: 500, message: 'something went wrong.' })
    }
  }
}

module.exports = new Symbol()
