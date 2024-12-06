const BlockListModel = require('../../models/block.model')
const SymbolModel = require('../../models/symbol.model')
const UserModel = require('../../models/users.model')
const { ObjectId } = require('../../helper/utilites.service')

class Block {
  // Block users based on role
  async blockUser(req, res) {
    try {
      const { id: adminId } = req.admin
      const { userId, scriptId } = req.body

      // Define user query for role hierarchy
      const userQuery = {
        $or: [
          { brokerId: adminId },
          { masterId: adminId },
          { superMasterId: adminId }
        ]
      }

      // Fetch user and symbol details
      const [findUser, findSymbol] = await Promise.all([
        UserModel.findOne({ _id: ObjectId(userId), ...userQuery }).lean(),
        SymbolModel.findById(ObjectId(scriptId)).lean()
      ])

      // Check if user and symbol exist
      if (!findUser) {
        return res.status(404).jsonp({ status: 404, message: 'User not found.' })
      }
      if (!findSymbol) {
        return res.status(404).jsonp({ status: 404, message: 'Symbol not found.' })
      }

      const isAlreadyBlock = await BlockListModel.findOne({
        blockOn: ObjectId(userId),
        scriptId: ObjectId(scriptId)
      }).lean()

      if (isAlreadyBlock) {
        return res.status(400).jsonp({ status: 400, message: 'User already blocked.' })
      }
      // Prepare query based on user role
      const query = {}
      if (findUser.role === 'broker') {
        query.brokerId = userId
      } else if (findUser.role === 'master') {
        query.masterId = userId
      }

      // Fetch all related users (brokers and end-users)
      const allUsers = await UserModel.find(query, { _id: 1, role: 1 }).lean()

      // Separate brokers and users
      const brokersId = []
      const usersId = []
      allUsers.forEach(user => {
        if (user.role === 'broker') {
          brokersId.push(user._id)
        } else if (user.role === 'user') {
          usersId.push(user._id)
        }
      })

      // Construct block list entry
      const blockData = {
        exchange: findSymbol.exchange,
        name: findSymbol.name,
        type: findSymbol.type,
        symbol: findSymbol.symbol,
        key: findSymbol.key,
        expiry: findSymbol.expiry,
        masterId: findUser.role === 'master' ? userId : undefined,
        brokersId: findUser.role === 'broker' ? [userId] : brokersId,
        usersId: findUser.role === 'user' ? [userId] : usersId,
        scriptId: scriptId,
        blockBy: adminId,
        blockOn: userId
      }

      // Save block entry
      await BlockListModel.create(blockData)

      return res.status(200).jsonp({ status: 200, message: 'User blocked successfully.' })
    } catch (error) {
      console.error('BlockService.blockUser', error.message)
      return res.status(500).jsonp({ status: 500, message: error.message || 'Something went wrong!' })
    }
  }

  async unblockUser(req, res) {
    try {
      const { id: adminId } = req.admin // Admin performing the unblock action
      const { userId, scriptId } = req.body // User and script to unblock

      // Validate input
      if (!ObjectId.isValid(userId) || !ObjectId.isValid(scriptId)) {
        return res.status(400).jsonp({ status: 400, message: 'Invalid userId or scriptId.' })
      }

      // Define user query for role hierarchy
      const userQuery = {
        $or: [
          { brokerId: adminId },
          { masterId: adminId },
          { superMasterId: adminId }
        ]
      }

      // Fetch user and symbol details
      const [findUser, findSymbol] = await Promise.all([
        UserModel.findOne({ _id: ObjectId(userId), ...userQuery }).lean(),
        SymbolModel.findById(ObjectId(scriptId)).lean()
      ])

      // Check if user and symbol exist
      if (!findUser) {
        return res.status(404).jsonp({ status: 404, message: 'User not found.' })
      }
      if (!findSymbol) {
        return res.status(404).jsonp({ status: 404, message: 'Symbol not found.' })
      }

      // Prepare the query to find the block entry
      const blockQuery = {
        scriptId: ObjectId(scriptId),
        blockOn: ObjectId(userId)
      }

      // Check if a block record exists
      const blockRecord = await BlockListModel.findOneAndDelete(blockQuery).lean()
      if (!blockRecord) {
        return res.status(404).jsonp({ status: 404, message: 'Block record not found.' })
      }

      return res.status(200).jsonp({ status: 200, message: 'User unblocked successfully.' })
    } catch (error) {
      console.error('BlockService.unblockUser', error.message)
      return res.status(500).jsonp({ status: 500, message: error.message || 'Something went wrong!' })
    }
  }

  async listBlockScripts(req, res) {
    try {
      const {
        exchange,
        type,
        symbol,
        masterId,
        brokerId,
        userId,
        blockBy,
        blockOn,
        startDate,
        endDate,
        search,
        page = 1,
        limit = 10,
        sortField = 'blockAt', // Default sort field
        sortOrder = 'desc' // Default sort order ('asc' or 'desc')
      } = req.query

      // Convert page and limit to integers
      const pageNumber = Math.max(parseInt(page, 10) || 1, 1) // Ensure positive integer
      const limitNumber = Math.max(parseInt(limit, 10) || 10, 1) // Ensure positive integer

      // Build query dynamically based on filters
      const query = {}
      if (exchange) query.exchange = exchange.toUpperCase()
      if (type) query.type = type.toUpperCase()
      if (symbol) query.symbol = { $regex: symbol, $options: 'i' }
      if (masterId) query.masterId = masterId
      if (brokerId) query.brokersId = brokerId
      if (userId) query.usersId = userId
      if (blockBy) query.blockBy = blockBy
      if (blockOn) query.blockOn = blockOn
      if (startDate || endDate) {
        query.blockAt = {}
        if (startDate) query.blockAt.$gte = new Date(startDate)
        if (endDate) query.blockAt.$lte = new Date(endDate)
      }
      if (search) {
        query.$or = [
          { name: { $regex: new RegExp('^.*' + search + '.*', 'i') } },
          { symbol: { $regex: new RegExp('^.*' + search + '.*', 'i') } },
          { type: { $regex: new RegExp('^.*' + search + '.*', 'i') } },
          { exchange: { $regex: new RegExp('^.*' + search + '.*', 'i') } },
          { key: { $regex: new RegExp('^.*' + search + '.*', 'i') } }
        ]
      }

      // Sort options
      const sortOptions = { [sortField]: sortOrder === 'asc' ? 1 : -1 }

      // Count total documents for pagination metadata
      const totalCount = await BlockListModel.countDocuments(query)

      // Fetch filtered and sorted block list with pagination
      const blockedScripts = await BlockListModel.find(query)
        .populate('masterId', '_id name code role')
        .populate('brokersId', '_id name code role')
        .populate('usersId', '_id name code role')
        .populate('blockBy', '_id name code role')
        .populate('blockOn', '_id name code role')
        .populate('scriptId')
        .sort(sortOptions)
        .skip((pageNumber - 1) * limitNumber)
        .limit(limitNumber)
        .lean()

      // Calculate total pages
      const totalPages = Math.ceil(totalCount / limitNumber)

      return res.status(200).jsonp({
        status: 200,
        message: 'Blocked scripts retrieved successfully.',
        data: {
          records: blockedScripts,
          pagination: {
            totalRecords: totalCount,
            totalPages: totalPages,
            currentPage: pageNumber,
            pageSize: limitNumber
          }
        }
      })
    } catch (error) {
      console.error('BlockService.listBlockScripts', error.message)
      return res.status(500).jsonp({
        status: 500,
        message: error.message || 'Something went wrong!'
      })
    }
  }

  async myBlockList(req, res) {
    try {
      const { id: userId } = req.admin
      const { page = 1, limit = 10, sortField = 'blockAt', sortOrder = 'desc', search, startDate, endDate } = req.query

      // Convert page and limit to integers
      const pageNumber = Math.max(parseInt(page, 10) || 1, 1)
      const limitNumber = Math.max(parseInt(limit, 10) || 10, 1)

      // Build query to fetch scripts related to the user
      const query = {
        $or: [
          { masterId: userId },
          { brokersId: userId },
          { usersId: userId },
          { blockOn: userId }
        ]
      }
      if (startDate || endDate) {
        query.blockAt = {}
        if (startDate) query.blockAt.$gte = new Date(startDate)
        if (endDate) query.blockAt.$lte = new Date(endDate)
      }

      if (search) {
        query.$or = [
          { name: { $regex: new RegExp('^.*' + search + '.*', 'i') } },
          { symbol: { $regex: new RegExp('^.*' + search + '.*', 'i') } },
          { type: { $regex: new RegExp('^.*' + search + '.*', 'i') } },
          { exchange: { $regex: new RegExp('^.*' + search + '.*', 'i') } },
          { key: { $regex: new RegExp('^.*' + search + '.*', 'i') } }
        ]
      }

      // Sort options
      const sortOptions = { [sortField]: sortOrder === 'asc' ? 1 : -1 }

      // Count total documents for pagination metadata
      const totalCount = await BlockListModel.countDocuments(query)

      // Fetch filtered and sorted block list with pagination
      const blockedScripts = await BlockListModel.find(query)
        .populate('masterId', '_id name code role')
        .populate('brokersId', '_id name code role')
        .populate('usersId', '_id name code role')
        .populate('blockBy', '_id name code role')
        .populate('blockOn', '_id name code role')
        .populate('scriptId')
        .sort(sortOptions)
        .skip((pageNumber - 1) * limitNumber)
        .limit(limitNumber)
        .lean()

      // Calculate total pages
      const totalPages = Math.ceil(totalCount / limitNumber)

      return res.status(200).jsonp({
        status: 200,
        message: 'My block list retrieved successfully.',
        data: {
          records: blockedScripts,
          pagination: {
            totalRecords: totalCount,
            totalPages: totalPages,
            currentPage: pageNumber,
            pageSize: limitNumber
          }
        }
      })
    } catch (error) {
      console.error('BlockService.myBlockList', error.message)
      return res.status(500).jsonp({
        status: 500,
        message: error.message || 'Something went wrong!'
      })
    }
  }

  async getBlockById(req, res) {
    try {
      const { id } = req.params
      const block = await BlockListModel.findById(id)
        .populate('masterId', '_id name code role')
        .populate('brokersId', '_id name code role')
        .populate('usersId', '_id name code role')
        .populate('blockBy', '_id name code role')
        .populate('blockOn', '_id name code role')
        .populate('scriptId')
        .lean()
      if (!block) {
        return res.status(404).jsonp({ status: 404, message: 'Block not found.' })
      }
      return res.status(200).jsonp({ status: 200, message: 'Block fetched successfully.', data: block })
    } catch (error) {
      console.error('BlockService.getBlockById', error.message)
      return res.status(500).jsonp({ status: 500, message: error.message || 'Something went wrong!' })
    }
  }
}

module.exports = new Block()
