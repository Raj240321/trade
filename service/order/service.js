/* eslint-disable max-lines */
const TradeModel = require('../../models/trade.model')
const SymbolModel = require('../../models/symbol.model')
const UserModel = require('../../models/users.model')
const PositionModel = require('../../models/positions.model')
const MyWatchList = require('../../models/scripts.model')
const { findSetting } = require('../settings/services')
const schedule = require('node-schedule')
const { LOGIN_ID } = require('../../config/config')
const { start, createToken } = require('../../queue')
const { ObjectId, getIp } = require('../../helper/utilites.service')
const { redisClient, queuePop, queuePush } = require('../../helper/redis')
const mongoose = require('mongoose')
const axios = require('axios')
const { DBconnected } = require('../../models/db/mongodb')
class OrderService {
  async executeTrade(req, res) {
    const {
      transactionType, // BUY or SELL
      symbolId, // Stock identifier
      quantity,
      orderType = 'MARKET', // Defaults to MARKET
      transactionFee = 0,
      lot = 1
    } = req.body
    let { price } = req.body
    const { id: userId } = req.admin // User/Admin making the request
    let transactionAmount = 0

    const userIp = getIp(req)
    try {
      // Validate user existence and activity
      const [user, stock, holiday, extraSession] = await Promise.all([
        UserModel.findById(userId).lean(),
        SymbolModel.findById(symbolId).lean(),
        findSetting('HOLIDAY_LIST'),
        findSetting('EXTRA_SESSION')
      ])

      if (!user || !user.isActive) {
        return await this.rejectTrade(
          res,
          'User not found or inactive.',
          'Your account is not active, please try again.',
          { transactionType, symbolId, quantity, price, orderType, transactionFee, userId, lot, userIp }
        )
      }

      if (!stock || !stock.active) {
        return await this.rejectTrade(
          res,
          'Stock not found or inactive.',
          'The selected stock is either not available or inactive.',
          { transactionType, symbolId, quantity, price, orderType, transactionFee, userId, lot, key: stock ? stock.key : '', userIp }
        )
      }
      if (orderType === 'MARKET') {
        price = await getMarketPrice(stock.key)
        if (!price) {
          return await this.rejectTrade(
            res,
            'Unable to fetch market price.',
            'Failed to retrieve the current market price for the stock.',
            { transactionType, symbolId, quantity, price, orderType, transactionFee, userId, lot, key: stock.key, userIp }
          )
        }
      }
      transactionAmount = quantity * price + transactionFee
      const currentDate = new Date()
      const isMarketOpen = await checkMarketOpen(currentDate, holiday, extraSession)
      if (!isMarketOpen) {
        return await this.rejectTrade(
          res,
          'Market is closed.',
          'Trading is only allowed during market hours or special sessions.',
          { transactionType, symbolId, quantity, price, orderType, transactionFee, userId, lot, key: stock.key, userIp }
        )
      }

      // Route trade type
      if (transactionType === 'BUY') {
        return await this.handleBuyTrade({
          user,
          stock,
          transactionAmount,
          quantity,
          price,
          orderType,
          transactionFee,
          symbolId,
          lot,
          userId,
          res,
          userIp
        })
      }

      if (transactionType === 'SELL') {
        return await this.handleSellTrade({
          user,
          stock,
          quantity,
          price,
          transactionFee,
          orderType,
          symbolId,
          lot,
          userId,
          res,
          userIp
        })
      }
    } catch (error) {
      console.error('Error executing trade:', error)
      return await this.rejectTrade(
        res,
        'Something went wrong.',
        'An unexpected error occurred while processing your request.',
        { transactionType, symbolId, quantity, price, orderType, transactionFee, userId, lot, userIp }
      )
    }
  }

  async rejectTrade(res, userMessage, remark, tradeDetails) {
    await this.createRejectedTrade({
      ...tradeDetails,
      executionStatus: 'REJECTED',
      remarks: remark
    })
    return res.status(400).json({ status: 400, message: userMessage })
  }

  async createRejectedTrade(tradeDetails) {
    return TradeModel.create({
      ...tradeDetails,
      executionStatus: 'REJECTED'
    })
  }

  async handleBuyTrade({
    user,
    stock,
    transactionAmount,
    quantity,
    price,
    orderType,
    transactionFee,
    symbolId,
    lot,
    userId,
    res,
    userIp
  }) {
    const session = await DBconnected.startSession()
    session.startTransaction()

    try {
      const alreadyTrade = await TradeModel.findOne({
        userId: ObjectId(userId),
        symbolId: ObjectId(symbolId),
        executionStatus: 'PENDING'
      }).lean()

      if (alreadyTrade) {
        await this.createRejectedTrade({
          transactionType: 'BUY',
          symbolId,
          quantity,
          price,
          orderType,
          transactionFee,
          userId,
          lot,
          remarks: 'You have already placed an order.',
          userIp
        })
        await session.abortTransaction()
        session.endSession()
        return res.status(400).json({ status: 400, message: 'Already buy order pending.' })
      }
      // Check if the user has sufficient balance
      if (transactionAmount > user.balance) {
        await this.createRejectedTrade({
          transactionType: 'BUY',
          symbolId,
          quantity,
          price,
          orderType,
          transactionFee,
          userId,
          lot,
          key: stock.key,
          remarks: 'Insufficient balance for trade.',
          userIp
        })

        // Rollback transaction and return an error
        await session.abortTransaction()
        session.endSession()

        return res.status(400).json({ status: 400, message: 'Insufficient balance for trade.' })
      }

      // Deduct the transaction amount from the user's balance
      user.balance -= transactionAmount

      const transactionId = new mongoose.Types.ObjectId()

      // Create a new trade record
      const trade = await TradeModel.create(
        [{
          transactionType: 'BUY',
          symbolId,
          quantity,
          price,
          orderType,
          transactionFee,
          userId,
          executionStatus: orderType === 'MARKET' ? 'EXECUTED' : 'PENDING',
          totalValue: transactionAmount,
          lot,
          key: stock.key,
          triggeredAt: orderType === 'MARKET' ? new Date() : null,
          remarks: orderType === 'MARKET' ? 'Order executed successfully' : '',
          transactionId,
          userIp,
          updatedBalance: orderType === 'MARKET' ? user.balance : 0
        }],
        { session }
      )

      if (orderType === 'MARKET') {
        // Update the user's balance in the database
        await UserModel.updateOne({ _id: userId }, { balance: user.balance }, { session })

        // Check if the user already has an open position
        const position = await PositionModel.findOne({ userId: ObjectId(userId), key: stock.key, status: 'OPEN' }).lean()

        if (position) {
          // Update the existing position
          const newQuantity = position.quantity + quantity
          const newAvgPrice = (position.avgPrice * position.quantity + price * quantity) / newQuantity
          const newLot = position.lot + lot

          await PositionModel.updateOne(
            { _id: position._id },
            { avgPrice: newAvgPrice, quantity: newQuantity, lot: newLot },
            { session }
          )

          // Update the user's watchlist
          await MyWatchList.updateOne(
            { userId: ObjectId(userId), key: stock.key },
            { avgPrice: newAvgPrice, quantity: newQuantity },
            { session }
          )
        } else {
          // Create a new position if none exists
          await PositionModel.create(
            [{
              userId,
              symbol: stock.symbol,
              key: stock.key,
              name: stock.name,
              type: stock.type,
              exchange: stock.exchange,
              marketLot: stock.BSQ,
              quantity,
              avgPrice: price,
              active: true,
              expiry: stock.expiry,
              symbolId: symbolId,
              lot,
              transactionReferences: trade._id,
              triggeredAt: new Date(),
              userIp
            }],
            { session }
          )

          // Add to the user's watchlist
          await MyWatchList.updateOne(
            { userId: ObjectId(userId), key: stock.key },
            { avgPrice: price, quantity },
            { session }
          )
        }
      } else {
        // Store the pending buy order in Redis
        await redisClient.set(`BUY-+${stock.key}-+${price}-+${transactionId}`, transactionId)
      }

      // Commit the transaction
      await session.commitTransaction()
      session.endSession()

      return res.status(200).json({
        status: 200,
        message: 'Buy trade processed successfully.',
        data: trade
      })
    } catch (error) {
      // Rollback the transaction on error
      await session.abortTransaction()
      session.endSession()

      console.error('Error in handleBuyTrade:', error)
      return res.status(500).json({ status: 500, message: 'An error occurred while processing the buy trade.' })
    }
  }

  async handleSellTrade({
    user,
    stock,
    quantity,
    price,
    transactionFee,
    orderType,
    symbolId,
    lot,
    userId,
    res,
    userIp
  }) {
    const session = await DBconnected.startSession()
    session.startTransaction()
    try {
      const position = await PositionModel.findOne({ userId, key: stock.key, status: 'OPEN' }).lean()
      const alreadyTrade = await TradeModel.findOne({
        userId: ObjectId(userId),
        symbolId: ObjectId(symbolId),
        executionStatus: 'PENDING'
      }).lean()
      if (alreadyTrade) {
        await this.createRejectedTrade({
          transactionType: 'SELL',
          symbolId,
          quantity,
          price,
          orderType,
          transactionFee,
          userId,
          lot,
          remarks: 'You have already placed an order.',
          userIp
        })
        // Rollback transaction and return an error
        await session.abortTransaction()
        session.endSession()
        return res.status(400).json({ status: 400, message: 'You have already placed an order.' })
      }
      if (!position || position.quantity < quantity) {
        await this.createRejectedTrade({
          transactionType: 'SELL',
          symbolId,
          quantity,
          price,
          orderType,
          transactionFee,
          userId,
          lot,
          remarks: 'Insufficient stock quantity to sell.',
          userIp
        })

        // Rollback transaction and return an error
        await session.abortTransaction()
        session.endSession()

        return res.status(400).json({ status: 400, message: 'Insufficient stock quantity to sell.' })
      }

      const saleProceeds = quantity * price - transactionFee
      user.balance += saleProceeds
      const remainingQuantity = position.quantity - quantity

      // Calculate realized profit/loss for this transaction
      const realizedPnlForThisTrade = (price - position.avgPrice) * quantity - transactionFee
      const transactionId = new mongoose.Types.ObjectId()

      // Create a new trade entry
      const trade = await TradeModel.create(
        [{
          transactionType: 'SELL',
          symbolId,
          quantity,
          price,
          key: stock.key,
          orderType,
          transactionFee,
          userId,
          executionStatus: orderType === 'MARKET' ? 'EXECUTED' : 'PENDING',
          totalValue: quantity * price,
          triggeredAt: orderType === 'MARKET' ? new Date() : null,
          lot,
          remarks: orderType === 'MARKET' ? 'Order executed successfully' : '',
          realizedPnl: realizedPnlForThisTrade, // Store P&L for this trade
          transactionId,
          userIp,
          updatedBalance: orderType === 'MARKET' ? user.balance : 0
        }],
        { session }
      )

      if (orderType === 'MARKET') {
        // Update position
        const update = remainingQuantity === 0
          ? { quantity: 0, status: 'CLOSED', closeDate: Date.now() }
          : { quantity: remainingQuantity }

        // Update total value and realized P&L
        update.totalValue = remainingQuantity === 0
          ? 0
          : position.avgPrice * remainingQuantity

        update.realizedPnl = (position.realizedPnl || 0) + realizedPnlForThisTrade

        // Update other fields
        update.avgPrice = remainingQuantity === 0 ? 0 : position.avgPrice
        update.lot = position.lot + lot

        await PositionModel.updateOne({ _id: position._id }, update, { session })

        // Update user's balance
        await UserModel.updateOne({ _id: userId }, { balance: user.balance }, { session })

        // Update user's watchlist
        await MyWatchList.updateOne(
          { userId: ObjectId(userId), key: stock.key },
          { quantity: remainingQuantity, avgPrice: update.avgPrice },
          { session }
        )
      } else {
        // Store pending sell order in Redis
        await redisClient.set(`SELL-+${stock.key}-+${price}-+${transactionId}`, transactionId)
      }

      // Commit the transaction
      await session.commitTransaction()
      session.endSession()

      return res.status(200).json({
        status: 200,
        message: 'Sell trade processed successfully.',
        data: trade
      })
    } catch (error) {
      // Rollback the transaction on error
      await session.abortTransaction()
      session.endSession()

      console.error('Error in handleSellTrade:', error)
      return res.status(500).json({ status: 500, message: 'An error occurred while processing the sell trade.' })
    }
  }

  async modifyPendingTrade(req, res) {
    const {
      quantity, // New quantity
      orderType, // New order type (e.g., MARKET, LIMIT)
      transactionFee = 0, // Optional transaction fee
      lot = 1 // Optional lot size
    } = req.body

    const { id: userId } = req.admin // User/Admin making the request
    const { id: tradeId } = req.params
    const userIp = getIp(req)
    let { price } = req.body
    try {
      // Fetch trade and user data
      const [trade, user] = await Promise.all([
        TradeModel.findById(tradeId).lean(),
        UserModel.findById(userId).lean()
      ])
      if (!trade) {
        return res.status(404).json({ status: 404, message: 'Trade not found.' })
      }
      const holiday = await findSetting('HOLIDAY_LIST')
      const extraSession = await findSetting('EXTRA_SESSION')
      const currentDate = new Date()
      const isMarketOpen = await checkMarketOpen(currentDate, holiday, extraSession)
      if (!isMarketOpen) {
        return res.status(400).json({ status: 400, message: 'Market is closed.' })
      }

      if (orderType === 'MARKET') {
        price = await getMarketPrice(trade.key)
        if (!price) {
          throw new Error('Invalid closing price for symbol.')
        }
      }
      const stock = await SymbolModel.findById(trade.symbolId).lean()
      if (trade.executionStatus !== 'PENDING') {
        return res.status(400).json({ status: 400, message: 'Only pending trades can be modified.' })
      }
      if (trade.userId.toString() !== userId.toString()) {
        return res.status(403).json({ status: 403, message: 'You do not have permission to modify this trade.' })
      }

      const transactionAmount = quantity * price + transactionFee

      if (trade.transactionType === 'BUY' && transactionAmount > user.balance) {
        await this.createRejectedTrade({
          transactionType: 'BUY',
          symbolId: trade.symbolId,
          quantity,
          price,
          orderType,
          transactionFee,
          userId,
          lot,
          key: trade.key,
          remarks: 'Insufficient balance to execute BUY trade.',
          userIp
        })
        return res.status(400).json({ status: 400, message: 'Insufficient balance to execute BUY trade.' })
      }

      // Prepare trade update data
      const updateData = {
        quantity,
        price,
        orderType,
        transactionFee,
        lot,
        totalValue: transactionAmount
      }
      const saleProceeds = quantity * price - transactionFee

      if (orderType === 'MARKET') {
        updateData.executionStatus = 'EXECUTED'
        updateData.triggeredAt = new Date()
        updateData.updatedBalance = trade.transactionType === 'BUY' ? user.balance - transactionAmount : user.balance + saleProceeds
      }

      // Update the trade in the database
      const updatedTrade = await TradeModel.findByIdAndUpdate(tradeId, { $set: updateData }, { new: true })

      if (orderType === 'MARKET') {
        if (trade.transactionType === 'BUY') {
          // Deduct balance
          const pattern = `BUY-+${stock.key}*${trade.transactionId}`
          const keys = await redisClient.keys(pattern) // Get all keys matching the pattern
          if (keys.length > 0) {
            await redisClient.del(keys) // Delete all matching keys
          }
          user.balance -= transactionAmount
          await UserModel.updateOne({ _id: userId }, { balance: user.balance })

          // Manage position
          const position = await PositionModel.findOne({ userId: ObjectId(userId), key: stock.key, status: 'OPEN' })

          if (position) {
            // Update existing position
            const newQuantity = position.quantity + quantity
            const newAvgPrice = (position.avgPrice * position.quantity + price * quantity) / newQuantity
            const newLot = position.lot + lot

            await PositionModel.updateOne(
              { _id: position._id },
              { avgPrice: newAvgPrice, quantity: newQuantity, lot: newLot }
            )
            await MyWatchList.updateOne(
              { userId: ObjectId(userId), key: stock.key },
              { avgPrice: newAvgPrice, quantity: newQuantity }
            )
          } else {
            // Create new position
            await PositionModel.create({
              userId,
              symbol: stock.symbol,
              key: stock.key,
              name: stock.name,
              type: stock.type,
              exchange: stock.exchange,
              marketLot: stock.BSQ,
              quantity,
              avgPrice: price,
              active: true,
              expiry: stock.expiry,
              symbolId: trade.symbolId,
              lot,
              transactionReferences: trade._id,
              triggeredAt: new Date(),
              userIp
            })

            await MyWatchList.updateOne(
              { userId: ObjectId(userId), key: stock.key },
              { avgPrice: price, quantity }
            )
          }
        } else if (trade.transactionType === 'SELL') {
          const pattern = `SELL-+${stock.key}*${trade.transactionId}`
          const keys = await redisClient.keys(pattern) // Get all keys matching the pattern
          if (keys.length > 0) {
            await redisClient.del(keys) // Delete all matching keys
          }
          // Validate and handle SELL trade execution
          const position = await PositionModel.findOne({ userId, key: stock.key, status: 'OPEN' }).lean()
          if (!position || position.quantity < quantity) {
            await this.createRejectedTrade({
              transactionType: 'SELL',
              symbolId: trade.symbolId,
              quantity,
              price,
              orderType,
              transactionFee,
              userId,
              lot,
              remarks: 'Insufficient stock quantity to sell.',
              userIp
            })
            return res.status(400).json({ status: 400, message: 'Insufficient stock quantity to sell.' })
          }
          const remainingQuantity = position.quantity - quantity
          const update = remainingQuantity === 0 ? { quantity: 0, status: 'CLOSED', lot: 0, closeDate: Date.now() } : { quantity: remainingQuantity }
          const totalValue = remainingQuantity === 0 ? 0 : position.quantity * position.avgPrice - quantity * price
          const totalLot = remainingQuantity === 0 ? 0 : (position.lot || 1) - lot
          const avgPrice = remainingQuantity === 0 ? 0 : position.avgPrice
          update.lot = totalLot
          update.totalValue = totalValue
          // Update user balance
          user.balance += saleProceeds
          await PositionModel.updateOne({ _id: position._id }, update)
          await UserModel.updateOne({ _id: userId }, { balance: user.balance })
          await MyWatchList.updateOne({ userId: ObjectId(userId), key: stock.key }, { quantity: remainingQuantity, avgPrice })
        }
      } else {
        if (trade.transactionType === 'BUY') {
          const pattern = `BUY-+${stock.key}*${trade.transactionId}`
          const keys = await redisClient.keys(pattern) // Get all keys matching the pattern
          if (keys.length > 0) {
            await redisClient.del(keys) // Delete all matching keys
          }
          await redisClient.set(`BUY-+${stock.key}-+${price}-+${trade.transactionId}`, trade.transactionId)
        } else if (trade.transactionType === 'SELL') {
          const pattern = `SELL-+${stock.key}*${trade.transactionId}`
          const keys = await redisClient.keys(pattern) // Get all keys matching the pattern
          if (keys.length > 0) {
            await redisClient.del(keys) // Delete all matching keys
          }
          await redisClient.set(`SELL-+${stock.key}-+${price}-+${trade.transactionId}`, trade.transactionId)
        }
      }

      return res.status(200).json({
        status: 200,
        message: 'Trade modified successfully.',
        data: updatedTrade
      })
    } catch (error) {
      console.error('Error modifying trade:', error)
      return res.status(500).json({ status: 500, message: 'Something went wrong.' })
    }
  }

  async cancelPendingTrade(req, res) {
    const { id: userId } = req.admin // User/Admin making the request
    const { id: tradeId } = req.params
    const userIp = getIp(req)

    try {
      // Validate trade existence and status
      const holiday = await findSetting('HOLIDAY_LIST')
      const extraSession = await findSetting('EXTRA_SESSION')

      const currentDate = new Date()
      const isMarketOpen = await checkMarketOpen(currentDate, holiday, extraSession)
      if (!isMarketOpen) {
        return res.status(400).json({ status: 400, message: 'Market is closed.' })
      }

      const trade = await TradeModel.findById(tradeId).lean()
      if (!trade) {
        return res.status(404).json({ status: 404, message: 'Trade not found.' })
      }

      // Validate user permissions
      const user = await UserModel.findOne({
        _id: ObjectId(trade.userId),
        $or: [{ _id: userId }, { masterId: userId }, { brokerId: userId }]
      }).lean()

      if (!user || trade.userId.toString() !== userId.toString()) {
        return res.status(403).json({ status: 403, message: 'You do not have permission to cancel this trade.' })
      }

      // Ensure trade is still pending
      if (trade.executionStatus !== 'PENDING') {
        return res.status(400).json({ status: 400, message: 'Only pending trades can be canceled.' })
      }

      // Update trade status
      const updateResult = await TradeModel.findByIdAndUpdate(
        tradeId,
        { executionStatus: 'CANCELED', remarks: 'Trade canceled by user.', userIp, deletedBy: userId },
        { new: true }
      )

      if (!updateResult) {
        return res.status(500).json({ status: 500, message: 'Failed to cancel the trade.' })
      }

      // Delete Redis keys
      const pattern = `${trade.orderType}-+${trade.key}*${trade.transactionId}`
      const keys = await redisClient.keys(pattern)
      if (keys.length > 0) {
        await redisClient.del(keys)
      }

      return res.status(200).json({ status: 200, message: 'Trade canceled successfully.' })
    } catch (error) {
      console.error(`Error canceling trade ${tradeId} by user ${userId}:`, error)
      return res.status(500).json({ status: 500, message: 'Something went wrong.' })
    }
  }

  async listMyTrade(req, res) {
    try {
      const { id: userId } = req.admin // User/Admin making the request
      const {
        transactionType,
        page = 1,
        limit = 20,
        search = '',
        executionStatus = '',
        sort = 'transactionDate',
        order = -1,
        orderType = '',
        range = '',
        from = '',
        to = ''
      } = req.query

      // Parse and validate pagination
      const skip = (Number(page) - 1) * Number(limit)

      // Construct the query
      const query = { userId: ObjectId(userId) }

      // Add filters
      if (transactionType) query.transactionType = transactionType
      if (executionStatus) query.executionStatus = executionStatus
      if (orderType) query.orderType = orderType

      // Search by key or remarks
      if (search) {
        query.$or = [
          { key: { $regex: search, $options: 'i' } },
          { remarks: { $regex: search, $options: 'i' } }
        ]
      }

      // Range filtering (numeric or date)
      if (range && from && to) {
        if (['transactionDate', 'price', 'totalValue', 'quantity', 'targetPrice', 'lot'].includes(range)) {
          if (range === 'transactionDate') {
            // Date range filtering
            query[range] = {
              $gte: new Date(from),
              $lte: new Date(to)
            }
          } else {
            // Numeric range filtering
            const fromNum = Number(from)
            const toNum = Number(to)
            if (isNaN(fromNum) || isNaN(toNum)) {
              return res.status(400).json({ status: 400, message: 'Invalid numeric range values.' })
            }
            query[range] = { $gte: fromNum, $lte: toNum }
          }
        } else {
          return res.status(400).json({ status: 400, message: 'Invalid range field.' })
        }
      }

      // Fetch trades with sorting and pagination
      const trades = await TradeModel.find(query)
        .sort({ [sort]: Number(order) })
        .skip(skip)
        .limit(Number(limit))
        .lean()
        .populate('symbolId')
        .populate('userId', '_id code name balance') // Populate specific fields

      // Count total trades for pagination
      const count = await TradeModel.countDocuments(query)

      return res.status(200).json({
        status: 200,
        message: 'My Trades fetched successfully.',
        data: trades,
        count,
        currentPage: Number(page),
        totalPages: Math.ceil(count / limit)
      })
    } catch (error) {
      console.error('Error fetching trades:', error)
      return res.status(500).json({ status: 500, message: 'Something went wrong.' })
    }
  }

  async listTradeByRole(req, res) {
    try {
      const { id, role } = req.admin // User/Admin making the request
      const objId = ObjectId(id)
      const {
        transactionType,
        page = 1,
        limit = 20,
        search = '',
        executionStatus = '',
        sort = 'transactionDate',
        order = -1,
        masterId = '',
        brokerId = '',
        userId = '',
        symbol = ''
      } = req.query

      const skip = (page - 1) * limit

      // Base user filtering query
      const userQuery = {}

      if (!(masterId || brokerId || userId)) {
        // Determine role-based filtering
        if (role === 'superMaster') {
          userQuery.superMasterId = objId
        } else if (role === 'master') {
          userQuery.masterId = objId
        } else if (role === 'broker') {
          userQuery.brokerId = objId
        } else if (role === 'user') {
          userQuery._id = objId
        }
      } else {
        // Additional filters based on query parameters
        if (masterId) {
          userQuery.masterId = ObjectId(masterId)
          userQuery.role = 'broker'
        }
        if (brokerId) {
          userQuery.brokerId = ObjectId(brokerId)
          userQuery.role = 'user'
        }
        if (userId) {
          userQuery._id = ObjectId(userId)
        }
      }

      // Fetch user IDs under the specified query
      const userList = await UserModel.find(userQuery, { _id: 1 }).lean()
      const userIds = userList.map((user) => user._id)

      // Trade filtering query
      const tradeQuery = { userId: { $in: userIds } }

      // Apply search filter
      if (search) {
        tradeQuery.$or = [
          { key: { $regex: search, $options: 'i' } },
          { remarks: { $regex: search, $options: 'i' } },
          { executionStatus: { $regex: search, $options: 'i' } }
        ]
      }

      // Apply symbol filter
      if (symbol) {
        tradeQuery.key = { $regex: symbol, $options: 'i' }
      }

      // Apply additional filters
      if (transactionType) tradeQuery.transactionType = transactionType
      if (executionStatus) tradeQuery.executionStatus = executionStatus

      // Fetch trades with sorting, pagination, and population
      const trades = await TradeModel.find(tradeQuery)
        .sort({ [sort]: order })
        .skip(skip)
        .limit(Number(limit))
        .lean()
        .populate('symbolId') // Populate symbol details

      // Count total trades for pagination
      const count = await TradeModel.countDocuments(tradeQuery)

      // Send response
      return res.status(200).json({
        status: 200,
        message: 'Trades fetched successfully.',
        data: trades,
        count,
        currentPage: page,
        totalPages: Math.ceil(count / limit)
      })
    } catch (error) {
      console.error('Error fetching trades:', error)
      return res.status(500).json({ status: 500, message: 'Something went wrong.' })
    }
  }

  async tradeById(req, res) {
    try {
      const { id: transactionId } = req.params
      const trade = await TradeModel.findById({ _id: transactionId }).lean().populate('symbolId')
      if (!trade) {
        return res.status(404).json({ status: 404, message: 'Trade not found.' })
      }
      return res.status(200).json({ status: 200, message: 'Trade fetched successfully.', data: trade })
    } catch (error) {
      console.error('Error fetching trade:', error)
      return res.status(500).json({ status: 500, message: 'Something went wrong.' })
    }
  }

  async listMyPosition(req, res) {
    try {
      const { id: userId } = req.admin // User/Admin making the request
      const {
        exchange,
        type,
        status,
        page = 1,
        limit = 20,
        search = '',
        symbol = '',
        sort = 'openDate',
        order = -1,
        range = '',
        from = '',
        to = ''
      } = req.query

      // Pagination
      const skip = (page - 1) * limit

      // Construct the query
      const query = { userId: ObjectId(userId) }

      if (exchange) query.exchange = exchange
      if (type) query.type = type
      if (status) query.status = status
      if (symbol) query.symbol = { $regex: symbol, $options: 'i' }

      // Search filter
      if (search) {
        query.$or = [
          { symbol: { $regex: search, $options: 'i' } },
          { name: { $regex: search, $options: 'i' } },
          { key: { $regex: search, $options: 'i' } }
        ]
      }

      // Range filtering for date or numeric fields
      if (range && from && to) {
        const fromValue = isNaN(from) ? new Date(from) : Number(from)
        const toValue = isNaN(to) ? new Date(to) : Number(to)

        query[range] = { $gte: fromValue, $lte: toValue }
      }
      // Fetch positions with sorting and pagination
      const positions = await PositionModel.find(query)
        .sort({ [sort]: order })
        .skip(skip)
        .limit(Number(limit))
        .lean()
        .populate('symbolId') // Populate specific fields, e.g., symbol details

      // Count total positions for pagination
      const count = await PositionModel.countDocuments(query)

      // Response
      return res.status(200).json({
        status: 200,
        message: 'My Positions fetched successfully.',
        data: positions,
        count,
        currentPage: page,
        totalPages: Math.ceil(count / limit)
      })
    } catch (error) {
      console.error('Error fetching positions:', error)
      return res.status(500).json({ status: 500, message: 'Something went wrong.' })
    }
  }

  async listPositionByRole(req, res) {
    try {
      const { id, role } = req.admin // User/Admin making the request
      const objId = ObjectId(id)
      const {
        exchange,
        type,
        status,
        page = 1,
        limit = 20,
        search = '',
        sort = 'openDate',
        order = -1,
        masterId = '',
        brokerId = '',
        userId = '',
        symbol = ''
      } = req.query

      // Pagination
      const skip = (page - 1) * limit

      // Base query for user roles
      let query = {
        $or: [{ brokerId: objId }, { masterId: objId }, { superMasterId: objId }]
      }

      // Determine role-based filtering
      if (!(masterId || brokerId || userId)) {
        if (role === 'superMaster') {
          query.superMasterId = objId
        } else if (role === 'master') {
          query.masterId = objId
        } else if (role === 'broker') {
          query.brokerId = objId
        } else if (role === 'user') {
          query._id = objId
        }
      } else {
        if (masterId) {
          query.masterId = ObjectId(masterId)
          query.role = 'broker'
        }
        if (brokerId) {
          query.brokerId = ObjectId(brokerId)
          query.role = 'user'
        }
        if (userId) query._id = ObjectId(userId)
      }

      // Fetch list of user IDs for filtering positions
      const userList = await UserModel.find(query, { _id: 1 }).lean()
      const userIds = userList.map(user => user._id)

      // Adjust the query to filter positions by user IDs
      query = {}
      query.userId = { $in: userIds }

      // Apply search filter
      if (search) {
        query.$or = [
          { symbol: { $regex: search, $options: 'i' } },
          { name: { $regex: search, $options: 'i' } },
          { key: { $regex: search, $options: 'i' } }
        ]
      }

      // Apply additional filters
      if (exchange) query.exchange = exchange
      if (type) query.type = type
      if (status) query.status = status
      if (symbol) query.symbol = { $regex: symbol, $options: 'i' }

      // Fetch positions with sorting, pagination, and symbol population
      const positions = await PositionModel.find(query)
        .sort({ [sort]: order })
        .skip(skip)
        .limit(Number(limit))
        .lean()
        .populate('symbolId') // Populate symbol details

      // Count total positions for pagination
      const count = await PositionModel.countDocuments(query)

      return res.status(200).json({
        status: 200,
        message: 'Positions fetched successfully.',
        data: positions,
        count,
        currentPage: page,
        totalPages: Math.ceil(count / limit)
      })
    } catch (error) {
      console.error('Error fetching positions:', error)
      return res.status(500).json({ status: 500, message: 'Something went wrong.' })
    }
  }

  async positionById(req, res) {
    try {
      const { id } = req.params
      const trade = await PositionModel.findById(id).lean().populate('symbolId').populate('userId', 'name code role')
      if (!trade) {
        return res.status(404).json({ status: 404, message: 'Trade not found.' })
      }
      return res.status(200).json({ status: 200, message: 'Trade fetched successfully.', data: trade })
    } catch (error) {
      console.error('Error fetching trade:', error)
      return res.status(500).json({ status: 500, message: 'Something went wrong.' })
    }
  }

  async generateLedgerReport(req, res) {
    const { id, role } = req.admin // User/Admin making the request
    try {
      const { page = 1, limit = 10, search, sort = 'triggeredAt', order = -1, transactionType } = req.query

      // Initialize allowed users array
      const allAllowedUser = []
      const query = {
        executionStatus: 'EXECUTED'
      }

      // If the user is not a superMaster, filter based on users assigned to the master or broker
      if (role !== 'superMaster') {
        const allUsersQuery = {
          $or: [{ masterId: ObjectId(id) }, { brokerId: ObjectId(id) }]
        }
        const users = await UserModel.find(allUsersQuery, { _id: 1 }).lean()
        allAllowedUser.push(...users.map(user => ObjectId(user._id)))
        query.userId = { $in: allAllowedUser }
      }

      // Add search functionality
      if (search) {
        query.$or = [
          { key: { $regex: search, $options: 'i' } },
          { executionStatus: { $regex: search, $options: 'i' } }
        ]
      }

      if (transactionType) {
        query.transactionType = transactionType
      }

      // Fetch user's trade data with pagination and sorting
      const trades = await TradeModel.find(query)
        .sort({ [sort]: order }) // Dynamic sort field and order
        .limit(Number(limit))
        .skip((page - 1) * limit) // Correct pagination with `skip`
        .populate('userId', 'code balance') // Populate user details (only 'code')
        .lean()

      // Check if trades exist
      if (!trades || trades.length === 0) {
        return res.status(404).json({ status: 404, message: 'No trades found.' })
      }

      // Calculate ledger report data
      const reportData = trades.map((trade, index) => {
        const debit = trade.transactionType === 'BUY' ? trade.totalValue : 0
        const credit = trade.transactionType === 'SELL' ? trade.totalValue : 0
        const balance = trade?.updatedBalance || 0

        // Generate remarks based on trade type, value, quantity, per price, and trade name
        const remarks =
          trade.transactionType === 'BUY'
            ? `Bought ${trade.quantity} ${trade.key} at ${trade.price.toFixed(2)} each for a total of ${debit.toFixed(2)}`
            : `Sold ${trade.quantity} ${trade.key} at ${trade.price.toFixed(2)} each for a total of ${credit.toFixed(2)}`

        return {
          SRNo: index + 1 + (page - 1) * limit, // Adjust for pagination
          Code: trade.userId?.code || 'N/A', // Ensure user code is displayed or 'N/A'
          Remarks: remarks,
          Date: trade.triggeredAt ? trade.triggeredAt.toISOString() : 'N/A',
          Debit: debit.toFixed(2), // Format to 2 decimals
          Credit: credit.toFixed(2), // Format to 2 decimals
          Balance: balance.toFixed(2) // Format to 2 decimals
        }
      })

      // Send the response
      return res.status(200).json({
        status: 200,
        message: 'Ledger report generated successfully.',
        data: reportData
      })
    } catch (error) {
      console.error('Error generating ledger report:', error)
      return res.status(500).json({ status: 500, message: 'Something went wrong.' })
    }
  }

  async exitPositions(req, res) {
    const { id } = req.admin
    const userIp = getIp(req) // Capturing user IP

    try {
      const { symbolIds } = req.body
      const aSymbolId = symbolIds.map((id) => ObjectId(id))
      const holiday = await findSetting('HOLIDAY_LIST')
      const extraSession = await findSetting('EXTRA_SESSION')

      const currentDate = new Date()
      const isMarketOpen = await checkMarketOpen(currentDate, holiday, extraSession)
      if (!isMarketOpen) {
        return res.status(400).json({ status: 400, message: 'Market is closed.' })
      }
      // Fetch open positions
      const openPositions = await PositionModel.find({
        symbolId: { $in: aSymbolId },
        userId: ObjectId(id),
        status: 'OPEN'
      })
        .populate('userId', '_id balance')
        .populate('symbolId')
        .lean()

      if (openPositions.length === 0) {
        console.log(`No open positions found for admin ${id}.`)
        return res.status(200).json({ status: 200, message: 'No open positions to close.' })
      }

      const tradeOperations = []
      const positionUpdates = []
      const userBalanceUpdates = []
      const pendingTradeUpdates = []

      for (const position of openPositions) {
        const { userId, quantity, avgPrice, symbolId, transactionFee = 0, lot, key } = position

        let closingPrice = await getMarketPrice(key)
        if (!closingPrice || closingPrice <= 0) {
          closingPrice = symbolId.lastPrice || 0
        }
        console.log('Closing price for symbol:', symbolId._id, 'is', closingPrice)

        if (closingPrice <= 0) {
          console.error(`Invalid closing price for symbol ${symbolId.name || symbolId._id}.`)
          return res.status(400).json({ status: 400, message: 'Invalid closing price detected.' })
        }

        const realizedPnl = (closingPrice - avgPrice) * quantity - transactionFee

        // Prepare trade entry
        tradeOperations.push({
          insertOne: {
            document: {
              transactionType: 'SELL',
              symbolId: symbolId._id,
              quantity,
              price: closingPrice,
              orderType: 'MARKET',
              transactionFee,
              userId: userId._id,
              executionStatus: 'EXECUTED',
              realizedPnl,
              userIp,
              totalValue: quantity * closingPrice,
              triggeredAt: new Date(),
              lot: lot || 1,
              remarks: 'Exit Position.',
              updatedBalance: userId.balance + realizedPnl
            }
          }
        })

        // Update position
        positionUpdates.push({
          updateOne: {
            filter: { _id: position._id },
            update: {
              status: 'CLOSED',
              closeDate: new Date(),
              quantity: 0,
              realizedPnl,
              totalValue: 0,
              userIp
            }
          }
        })

        // Update user balance
        userBalanceUpdates.push({
          updateOne: {
            filter: { _id: userId._id },
            update: { $inc: { balance: realizedPnl } }
          }
        })
      }

      // Fetch pending trades
      const pendingTrades = await TradeModel.find({
        symbolId: { $in: aSymbolId },
        userId: ObjectId(id),
        executionStatus: 'PENDING'
      }).lean()

      pendingTrades.forEach((trade) => {
        pendingTradeUpdates.push({
          updateOne: {
            filter: { _id: trade._id },
            update: { executionStatus: 'CANCELLED', remarks: 'Cancelled due to exit.', userIp, deletedBy: ObjectId(id) }
          }
        })
      })

      // Begin transaction
      const session = await DBconnected.startSession()
      session.startTransaction()
      try {
        // Execute bulk operations
        if (tradeOperations.length > 0) {
          await TradeModel.bulkWrite(tradeOperations, { session, ordered: false })
        }
        if (positionUpdates.length > 0) {
          await PositionModel.bulkWrite(positionUpdates, { session, ordered: false })
        }
        if (userBalanceUpdates.length > 0) {
          await UserModel.bulkWrite(userBalanceUpdates, { session, ordered: false })
        }
        if (pendingTradeUpdates.length > 0) {
          await TradeModel.bulkWrite(pendingTradeUpdates, { session, ordered: false })
        }

        // Update watchlist
        const watchlistUpdate = await MyWatchList.updateMany(
          { symbolId: { $in: aSymbolId }, userId: ObjectId(id), quantity: { $gt: 0 } },
          { quantity: 0, avgPrice: 0 },
          { session }
        )
        console.log(`Updated watchlist for admin ${id}. Matched: ${watchlistUpdate.matchedCount}, Modified: ${watchlistUpdate.modifiedCount}`)

        await session.commitTransaction()
        console.log(`Positions closed and trades cancelled for admin ${id}.`)
      } catch (error) {
        await session.abortTransaction()
        console.error('Error during transaction:', error)
        return res.status(500).json({ status: 500, message: 'Transaction failed.' })
      } finally {
        session.endSession()
      }

      return res.status(200).json({ status: 200, message: 'Positions closed.' })
    } catch (error) {
      console.error(`Error closing positions for admin ${id}:`, error)
      return res.status(500).json({ status: 500, message: 'Something went wrong.' })
    }
  }

  async rollOver(req, res) {
    const { id } = req.admin
    const userIp = getIp(req)
    try {
      const { currentSymbolId } = req.body

      // Fetch settings and check if market is open
      const [holiday, extraSession] = await Promise.all([
        findSetting('HOLIDAY_LIST'),
        findSetting('EXTRA_SESSION')
      ])
      const currentDate = new Date()
      const isMarketOpen = await checkMarketOpen(currentDate, holiday, extraSession)
      if (!isMarketOpen) {
        return res.status(400).json({ status: 400, message: 'Market is closed.' })
      }

      const currentSymbolObjectId = ObjectId(currentSymbolId)
      const user = await UserModel.findById(id).lean()
      if (!user) {
        return res.status(400).json({ status: 400, message: 'User not found.' })
      }
      if (!user.isTrade) {
        return res.status(400).json({ status: 400, message: 'User is not allowed to trade.' })
      }

      // Fetch current symbol and find the new symbol
      const currentSymbol = await SymbolModel.findOne({ _id: currentSymbolObjectId, expiry: currentDate, active: true }).lean()
      if (!currentSymbol) {
        return res.status(400).json({ status: 400, message: 'No active symbol found/Only todays expiry symbol can rollover.' })
      }

      const newSymbol = await SymbolModel.find({ symbol: currentSymbol.key, expiry: { $gte: currentSymbol.expiry }, active: true })
        .sort({ expiry: 1 })
        .limit(1)
        .lean()

      if (!newSymbol.length) {
        return res.status(400).json({ status: 400, message: 'No active symbol found.' })
      }

      const newSymbolObjectId = newSymbol[0]

      // Fetch the user's active position for current symbol
      const position = await PositionModel.findOne({ symbolId: currentSymbolObjectId, userId: ObjectId(id), status: 'OPEN' }).lean()
      if (!position) {
        return res.status(400).json({ status: 400, message: 'No active position found.' })
      }

      const currentSymbolPrice = await getMarketPrice(currentSymbol.key)
      const newSymbolPrice = await getMarketPrice(newSymbol.key)
      if (!currentSymbolPrice || !newSymbolPrice) {
        return res.status(400).json({ status: 400, message: 'Something went wrong with market price.' })
      }
      const userBalance = user.balance

      // Calculate the PNL for current position and required balance for new position
      const pnlFromCurrent = (currentSymbolPrice - position.avgPrice) * position.quantity - (position.transactionFee || 0)
      const priceRequiredForNew = newSymbolPrice * position.quantity + (position.transactionFee || 0)
      const isValidToBuy = userBalance + pnlFromCurrent - priceRequiredForNew

      if (isValidToBuy < 0) {
        return res.status(400).json({ status: 400, message: 'Insufficient balance to rollover.' })
      }

      const session = await DBconnected.startSession()
      session.startTransaction()

      try {
        // Cancel pending trades for the current symbol
        await TradeModel.updateMany({ symbolId: currentSymbolObjectId, userId: ObjectId(id), executionStatus: 'PENDING' }, {
          $set: {
            executionStatus: 'CANCELLED',
            remarks: 'Cancelled due to rollover.',
            userIp,
            deletedBy: ObjectId(id),
            updatedBalance: userBalance
          }
        }).session(session)

        // Close current position
        await PositionModel.updateMany({ symbolId: currentSymbolObjectId, userId: ObjectId(id), status: 'OPEN' }, {
          $set: {
            status: 'CLOSED',
            closeDate: new Date(),
            quantity: 0,
            realizedPnl: pnlFromCurrent,
            totalValue: 0,
            userIp
          }
        }).session(session)

        // Update user's balance
        await UserModel.updateOne({ _id: ObjectId(id) }, { $inc: { balance: pnlFromCurrent } }).session(session)

        // Record the trade for selling the current symbol
        await TradeModel.create([{
          transactionType: 'SELL',
          symbolId: currentSymbolObjectId,
          quantity: position.quantity,
          price: currentSymbolPrice,
          orderType: 'MARKET',
          transactionFee: position.transactionFee || 0,
          userId: ObjectId(id),
          executionStatus: 'EXECUTED',
          realizedPnl: pnlFromCurrent,
          userIp,
          totalValue: position.quantity * currentSymbolPrice,
          triggeredAt: new Date(),
          lot: position.lot || 1,
          remarks: 'Rollover.',
          updatedBalance: userBalance + pnlFromCurrent
        }]).session(session)

        // Update watchlist for current symbol
        await MyWatchList.updateMany({ symbolId: currentSymbolObjectId, userId: ObjectId(id), quantity: { $gt: 0 } }, { quantity: 0, avgPrice: 0 }).session(session)

        // Buy the new position
        await PositionModel.create([{
          symbolId: newSymbolObjectId,
          userId: ObjectId(id),
          status: 'OPEN',
          quantity: position.quantity,
          avgPrice: newSymbolPrice,
          transactionFee: position.transactionFee || 0,
          lot: position.lot || 1,
          userIp
        }]).session(session)

        // Record the trade for buying the new symbol
        await TradeModel.create([{
          transactionType: 'BUY',
          symbolId: newSymbolObjectId,
          quantity: position.quantity,
          price: newSymbolPrice,
          orderType: 'MARKET',
          transactionFee: position.transactionFee || 0,
          userId: ObjectId(id),
          executionStatus: 'EXECUTED',
          realizedPnl: 0,
          userIp,
          totalValue: position.quantity * newSymbolPrice,
          triggeredAt: new Date(),
          lot: position.lot || 1,
          remarks: 'Rollover.',
          updatedBalance: priceRequiredForNew
        }]).session(session)

        // Deduct the required balance for the new position
        await UserModel.updateOne({ _id: ObjectId(id) }, { $inc: { balance: -priceRequiredForNew } }).session(session)

        // Update the watchlist for the new symbol
        await MyWatchList.updateOne({ symbolId: newSymbolObjectId, userId: ObjectId(id) }, { $inc: { quantity: position.quantity, avgPrice: newSymbolPrice } }, { upsert: true }).session(session)

        // Commit the transaction
        await session.commitTransaction()
      } catch (error) {
        await session.abortTransaction()
        console.error(`Error during rollover for admin ${id}:`, error)
        return res.status(500).json({ status: 500, message: 'Something went wrong.' })
      } finally {
        // End session after transaction
        session.endSession()
      }

      // Return success response
      return res.status(200).json({ status: 200, message: 'Rollover completed successfully.' })
    } catch (error) {
      console.error(`Unexpected error during rollover for admin ${id}:`, error)
      return res.status(500).json({ status: 500, message: 'Something went wrong.' })
    }
  }
}

module.exports = new OrderService()

async function completeBuyOrder() {
  let data
  try {
    // Pop the next executed buy order from the queue
    data = await queuePop('EXECUTED_BUY')

    if (!data) {
      // If there's no data, retry after 1 second
      return setTimeout(completeBuyOrder, 1000)
    }

    // Parse the data
    const transactionId = data
    // Fetch trade details based on transaction ID
    const trade = await TradeModel.findOne({ transactionId, executionStatus: 'PENDING' }).lean()

    if (!trade) {
      console.log(`No trade found for transactionId: ${transactionId}`)
      return setTimeout(completeBuyOrder, 1000) // Retry after 1 second
    }

    const { userId, symbolId, quantity, price, transactionFee, lot } = trade

    // Fetch user and stock details
    const [user, stock] = await Promise.all([
      UserModel.findOne({ _id: ObjectId(userId) }).lean(),
      SymbolModel.findOne({ _id: ObjectId(symbolId) }).lean()
    ])

    const transactionAmount = quantity * price + transactionFee

    // Check if the user has sufficient balance
    if (transactionAmount > user.balance) {
      console.log(`Insufficient balance to execute BUY trade for transactionId: ${transactionId}`)
      // Reject the trade and log it
      await TradeModel.create({
        transactionType: 'BUY',
        symbolId: trade.symbolId,
        quantity,
        price,
        orderType: trade.orderType,
        transactionFee,
        userId,
        lot,
        key: trade.key,
        remarks: 'Insufficient balance to execute BUY trade.',
        executionStatus: 'REJECTED'
      })
      // Retry after 1 second
      return setTimeout(completeBuyOrder, 1000)
    }

    const session = await DBconnected.startSession()
    session.startTransaction()

    try {
      // Deduct balance from user
      const pattern = `BUY-+${stock.key}*${trade.transactionId}`
      const keys = await redisClient.keys(pattern) // Get all keys matching the pattern
      if (keys.length > 0) {
        await redisClient.del(keys) // Delete all matching keys
      }
      user.balance -= transactionAmount
      await UserModel.updateOne({ _id: userId }, { balance: user.balance }, { session })

      // Manage position: Check if the user already has an open position
      const position = await PositionModel.findOne({ userId: ObjectId(userId), key: stock.key, status: 'OPEN' }).lean()

      if (position) {
        // Update existing position with the new buy order details
        const newQuantity = position.quantity + quantity
        const newAvgPrice = (position.avgPrice * position.quantity + price * quantity) / newQuantity
        const newLot = position.lot + lot

        // Update the position in the database
        await PositionModel.updateOne(
          { _id: position._id },
          { avgPrice: newAvgPrice, quantity: newQuantity, lot: newLot },
          { session }
        )

        // Update the user's watchlist with the new position data
        await MyWatchList.updateOne(
          { userId: ObjectId(userId), key: stock.key },
          { avgPrice: newAvgPrice, quantity: newQuantity },
          { session }
        )
      } else {
        // Create a new position if none exists
        await PositionModel.create({
          userId,
          symbol: stock.symbol,
          key: stock.key,
          name: stock.name,
          type: stock.type,
          exchange: stock.exchange,
          marketLot: stock.BSQ,
          quantity,
          avgPrice: price,
          active: true,
          expiry: stock.expiry,
          symbolId: trade.symbolId,
          lot,
          transactionReferences: trade._id,
          triggeredAt: new Date()
        }, { session })

        // Update the user's watchList with the new position data
        await MyWatchList.updateOne(
          { userId: ObjectId(userId), key: stock.key },
          { avgPrice: price, quantity },
          { session }
        )
      }

      // Update the trade status to EXECUTED
      await TradeModel.updateOne({ _id: trade._id }, { executionStatus: 'EXECUTED', remarks: 'Trade executed successfully.', updatedBalance: user.balance }, { session })

      // Commit the transaction
      await session.commitTransaction()
      session.endSession()

      console.log(`Executed BUY trade for transactionId: ${transactionId} successfully.`)

      // Continue processing the next buy order
      return completeBuyOrder() // Recursive call to continue processing
    } catch (error) {
      // Abort the transaction in case of error
      await session.abortTransaction()
      session.endSession()

      console.error('Error processing buy order:', error)
      if (data) {
        await queuePush('dead:EXECUTED_BUY', data)
      }

      // Retry after 1 second
      return setTimeout(completeBuyOrder, 1000)
    }
  } catch (error) {
    console.error('Error processing buy order:', error)
    if (data) {
      await queuePush('dead:EXECUTED_BUY', data)
    }
    // Retry after 1 second
    return setTimeout(completeBuyOrder, 1000)
  }
}

async function completeSellOrder() {
  let data
  try {
    data = await queuePop('EXECUTED_SELL')

    if (!data) {
      return setTimeout(completeSellOrder, 1000) // Retry after 1 second
    }

    const { transactionId } = JSON.parse(data)
    const trade = await TradeModel.findOne({ transactionId: ObjectId(transactionId), executionStatus: 'PENDING' }).lean()

    if (!trade) {
      console.log(`No trade found for transactionId: ${transactionId}`)
      return setTimeout(completeSellOrder, 1000) // Retry after 1 second
    }

    const { userId, symbolId, quantity, price, transactionFee, lot } = trade
    const [user, stock] = await Promise.all([
      UserModel.findOne({ _id: userId }).lean(),
      SymbolModel.findOne({ _id: symbolId }).lean()
    ])

    const position = await PositionModel.findOne({
      userId: ObjectId(userId),
      key: stock.key,
      status: 'OPEN'
    }).lean()

    if (!position || position.quantity < quantity) {
      console.log(`Insufficient stock quantity for transactionId: ${transactionId}`)
      await TradeModel.create({
        transactionType: 'SELL',
        symbolId: trade.symbolId,
        quantity,
        price,
        orderType: trade.orderType,
        transactionFee,
        userId,
        lot,
        key: trade.key,
        remarks: 'Insufficient stock quantity to sell.',
        executionStatus: 'REJECTED'
      })
      return setTimeout(completeSellOrder, 1000) // Retry after 1 second
    }

    const saleProceeds = quantity * price - transactionFee
    const remainingQuantity = position.quantity - quantity
    const realizedPnlForThisTrade = (price - position.avgPrice) * quantity - transactionFee

    const update = remainingQuantity === 0 ? { quantity: 0, status: 'CLOSED', closeDate: Date.now() } : { quantity: remainingQuantity }
    update.totalValue = remainingQuantity === 0 ? 0 : position.avgPrice * remainingQuantity
    update.realizedPnl = (position.realizedPnl || 0) + realizedPnlForThisTrade
    update.avgPrice = remainingQuantity === 0 ? 0 : position.avgPrice
    update.lot = position.lot + lot

    const session = await DBconnected.startSession()
    session.startTransaction()
    try {
      await PositionModel.updateOne({ _id: position._id }, update, { session })
      await UserModel.updateOne({ _id: userId }, { balance: user.balance + saleProceeds }, { session })
      await MyWatchList.updateOne(
        { userId: ObjectId(userId), key: stock.key },
        { quantity: remainingQuantity, avgPrice: update.avgPrice },
        { session }
      )
      await TradeModel.updateOne({ _id: trade._id }, { executionStatus: 'EXECUTED', remarks: 'Trade executed successfully.', updatedBalance: user.balance }, { session })

      await session.commitTransaction()
      session.endSession()
      console.log(`Executed SELL trade for transactionId: ${transactionId} successfully.`)
      return completeSellOrder() // Continue processing the next sell order
    } catch (error) {
      await session.abortTransaction()
      session.endSession()
      console.error('Error processing sell order:', error)
      if (data) {
        await queuePush('dead:EXECUTED_SELL', data)
      }
      return setTimeout(completeSellOrder, 1000) // Retry after 1 second
    }
  } catch (error) {
    console.error('Error processing sell order:', error)
    if (data) {
      await queuePush('dead:EXECUTED_SELL', data)
    }
    return setTimeout(completeSellOrder, 1000) // Retry after 1 second
  }
}

// Utility function to handle market open hours
async function checkMarketOpen(currentDate, holiday, extraSession) {
  const marketOpenTime = '09:16:00'
  const marketCloseTime = '15:29:00'
  const timeZone = 'Asia/Kolkata' // Replace with your market's time zone

  // Convert current date to the market's time zone
  const marketDate = new Date(currentDate.toLocaleString('en-US', { timeZone }))
  const marketDateString = marketDate.toISOString().split('T')[0]

  // Check if today is a holiday
  if (holiday && holiday.value.includes(marketDateString)) {
    console.log('Today is a holiday:', marketDateString)
    return false
  }

  // Check if the market is closed on weekends
  const currentDay = marketDate.getDay() // 0: Sunday, 1: Monday, ..., 6: Saturday
  if (currentDay === 0 || currentDay === 6) {
    if (extraSession && extraSession.value.includes(marketDateString)) {
      return true
    }
    console.log('Market is closed on weekends:', marketDateString)
    return false
  }

  // Check current time within market hours
  const currentTime = marketDate.toTimeString().split(' ')[0]
  console.log('Current time:', currentTime, 'Market open:', marketOpenTime, 'Market close:', marketCloseTime)

  // Compare market time
  if (currentTime < marketOpenTime || currentTime > marketCloseTime) {
    console.log('Market is closed due to time')
    return false
  }

  return true
}

setTimeout(() => {
  completeBuyOrder()
  completeSellOrder()
}, 2000)

schedule.scheduleJob('15 9 * * *', async function () {
  try {
    const currentDate = new Date()
    const [holiday, extraSession] = await Promise.all([
      findSetting('HOLIDAY_LIST'),
      findSetting('EXTRA_SESSION')
    ])
    const isMarketOpen = await checkMarketOpen(currentDate, holiday, extraSession)
    if (isMarketOpen) {
      await start()
    }
  } catch (error) {
    console.log('error', error)
  }
})

async function getMarketPrice(key) {
  try {
    const data = await redisClient.get(`${key}.json`)
    if (data) {
      return data.LTP
    } else {
      let sessionToken = await redisClient.get('sessionToken')
      if (!sessionToken) {
        sessionToken = await createToken()
        if (!sessionToken) return false
      }
      const ur = `https://qbase1.vbiz.in/directrt/getdata?loginid=${LOGIN_ID}&product=DIRECTRTLITE&accesstoken=${sessionToken}&tickerlist=${key}.JSON`
      try {
        const res = await axios.get(ur)
        if (res.data) {
          return res.data.LTP
        }
        return false
      } catch (err) {
        return false
      }
    }
  } catch (error) {
    console.log(error)
    return false
  }
}

async function startService() {
  try {
    const currentDate = new Date()
    const [holiday, extraSession] = await Promise.all([
      findSetting('HOLIDAY_LIST'),
      findSetting('EXTRA_SESSION')
    ])
    const isMarketOpen = await checkMarketOpen(currentDate, holiday, extraSession)
    if (isMarketOpen) {
      await start()
    }
  } catch (error) {
    console.log('error', error)
  }
}

setTimeout(() => {
  startService()
}, 2000)
