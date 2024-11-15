const WatchListModel = require('../../models/scripts.model')
const SymbolModel = require('../../models/symbol.model')
class MyWatchList {
  async addWatchList(req, res) {
    try {
      const { id: userId } = req.admin
      let { keys } = req.body

      // Normalize keys to uppercase
      keys = keys.map((key) => key.toUpperCase())

      // Fetch active symbols matching the provided keys
      const scripts = await SymbolModel.find(
        { key: { $in: keys }, active: true },
        { _id: 1, key: 1, exchange: 1, name: 1, type: 1, symbol: 1, expiry: 1, marketLot: 1 }
      ).lean()

      // Fetch user's existing active watchlist items
      const existingWatchList = await WatchListModel.find(
        { userId, key: { $in: keys }, active: true },
        { key: 1 }
      ).lean()

      const existingKeys = new Set(existingWatchList.map((item) => item.key))
      const scriptKeys = new Set(scripts.map((script) => script.key))

      // Classify keys into invalid, already added, and valid categories
      const invalidKeys = keys.filter((key) => !scriptKeys.has(key))
      const alreadyAddedKeys = keys.filter((key) => existingKeys.has(key))
      const validKeys = scripts.filter((script) => !existingKeys.has(script.key))

      // Prepare new watchlist entries
      const newWatchList = validKeys.map((script) => ({
        userId,
        scriptId: script._id,
        key: script.key,
        exchange: script.exchange,
        name: script.name,
        type: script.type,
        symbol: script.symbol,
        expiry: script.expiry,
        active: true,
        marketLot: script.marketLot,
        quantity: 0,
        avgPrice: 0
      }))

      // Insert new watchlist entries
      if (newWatchList.length) {
        await WatchListModel.insertMany(newWatchList)
      }

      return res.status(200).json({
        status: 200,
        message: 'WatchList added successfully',
        data: { invalidKeys, alreadyAddedKeys, validKeys }
      })
    } catch (error) {
      console.error('Error adding to watchlist:', error)
      return res.status(500).json({ status: 500, message: 'Something went wrong' })
    }
  }

  async filterWatchList(req, res) {
    try {
      const { id: userId } = req.admin // Get userId from admin context
      const {
        exchange, // Optional: NSE, MCX
        type, // Optional: FUTCOM, FUTSTK
        symbol, // Optional: Partial or exact match for symbol
        expiryFrom, // Optional: Start date for expiry filter
        expiryTo, // Optional: End date for expiry filter
        page = 1, // Optional: Page number for pagination
        limit = 20, // Optional: Number of items per page
        search = '' // Optional: Search string for symbol, name, or key
      } = req.query

      // Convert page and limit to integers
      const pageNumber = parseInt(page, 10)
      const pageSize = parseInt(limit, 10)

      // Build dynamic filter object
      const filter = { userId }

      if (exchange) filter.exchange = exchange.toUpperCase()
      if (type) filter.type = type.toUpperCase()
      if (symbol) filter.symbol = new RegExp(symbol, 'i') // Case-insensitive partial match
      if (expiryFrom || expiryTo) {
        filter.expiry = {}
        if (expiryFrom) filter.expiry.$gte = new Date(expiryFrom)
        if (expiryTo) filter.expiry.$lte = new Date(expiryTo)
      }
      if (search) {
        filter.$or = [
          { symbol: new RegExp(search, 'i') }, // Search in symbol
          { name: new RegExp(search, 'i') }, // Search in name
          { key: new RegExp(search, 'i') } // Search in key
        ]
      }

      // Fetch paginated watchList items based on the filters
      const totalItems = await WatchListModel.countDocuments(filter)
      const watchList = await WatchListModel.find(filter)
        .sort({ expiry: 1 }) // Optional: Sort by expiry date ascending
        .skip((pageNumber - 1) * pageSize)
        .limit(pageSize)
        .populate('scriptId')
        .lean()

      return res.status(200).json({
        status: 200,
        message: 'Filtered watchlist retrieved successfully',
        data: {
          watchList,
          total: totalItems
        }
      })
    } catch (error) {
      console.error('Error filtering watchlist:', error)
      return res.status(500).json({ status: 500, message: 'Something went wrong' })
    }
  }

  async removeWatchList(req, res) {
    try {
      const { id: userId } = req.admin
      let { keys } = req.body

      // Normalize keys to uppercase for consistency
      keys = keys.map((key) => key.toUpperCase())

      // Fetch user's active watchlist items that match the provided keys
      const activeWatchListItems = await WatchListModel.find(
        { userId, key: { $in: keys }, active: true },
        { _id: 1, key: 1 }
      ).lean()

      const activeKeys = new Set(activeWatchListItems.map((item) => item.key))

      // Classify keys into valid (to be removed) and invalid (not found or already inactive)
      const validKeys = keys.filter((key) => activeKeys.has(key))
      const invalidKeys = keys.filter((key) => !activeKeys.has(key))

      // Remove watchlist items with valid keys
      if (validKeys.length) {
        await WatchListModel.deleteMany(
          { userId, key: { $in: validKeys } }
        )
      }

      return res.status(200).json({
        status: 200,
        message: 'WatchList items removed successfully',
        data: { removedKeys: validKeys, invalidKeys }
      })
    } catch (error) {
      console.error('Error removing from watchlist:', error)
      return res.status(500).json({ status: 500, message: 'Something went wrong' })
    }
  }

  async getById(req, res) {
    try {
      const { id: userId } = req.admin
      const { id } = req.params

      // Fetch watchlist item by ID and userId
      const watchListItem = await WatchListModel.findOne({ _id: id, userId }).populate('scriptId').lean()

      if (!watchListItem) {
        return res.status(404).json({ status: 404, message: 'WatchList item not found' })
      }

      return res.status(200).json({
        status: 200,
        message: 'WatchList item retrieved successfully',
        data: watchListItem
      })
    } catch (error) {
      console.error('Error fetching watchlist item:', error)
      return res.status(500).json({ status: 500, message: 'Something went wrong' })
    }
  }
}

module.exports = new MyWatchList()
