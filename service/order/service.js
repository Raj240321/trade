/* eslint-disable max-lines */
const TradeModel = require('../../models/trade.model')
const SymbolModel = require('../../models/symbol.model')
const UserModel = require('../../models/users.model')
const PositionModel = require('../../models/positions.model')
const MyWatchList = require('../../models/scripts.model')
const { findSetting } = require('../settings/services')
const schedule = require('node-schedule')
const { start } = require('../../queue')
const { ObjectId, getIp } = require('../../helper/utilites.service')
const { redisClient, queuePop, queuePush } = require('../../helper/redis')
const mongoose = require('mongoose')
class OrderService {
  async executeTrade(req, res) {
    const {
      transactionType, // BUY or SELL
      symbolId, // Stock identifier
      quantity,
      price,
      orderType = 'MARKET', // Defaults to MARKET
      transactionFee = 0,
      lot = 1
    } = req.body

    const { id: userId } = req.admin // User/Admin making the request
    const transactionAmount = quantity * price + transactionFee

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

  // Reusable function to handle rejected trades
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
    // Check balance
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
      return res.status(400).json({ status: 400, message: 'Insufficient balance for trade.' })
    }

    const transactionId = new mongoose.Types.ObjectId()
    const trade = await TradeModel.create({
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
      userIp
    })

    if (orderType === 'MARKET') {
      // Deduct balance
      user.balance -= transactionAmount
      await UserModel.updateOne({ _id: userId }, { balance: user.balance })

      // Manage position
      const position = await PositionModel.findOne({ userId: ObjectId(userId), key: stock.key, status: 'OPEN' })

      if (position) {
        // Update existing position
        const newQuantity = position.quantity + quantity
        const newAvgPrice =
          (position.avgPrice * position.quantity + price * quantity) / newQuantity
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
          symbolId: symbolId,
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
    } else {
      await redisClient.set(`BUY_${stock.key}_${price}_${transactionId}`)
    }

    return res.status(200).json({ status: 200, message: 'Buy trade processed successfully.', data: trade })
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
    const position = await PositionModel.findOne({ userId, key: stock.key, status: 'OPEN' }).lean()

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
      return res.status(400).json({ status: 400, message: 'Insufficient stock quantity to sell.' })
    }

    const saleProceeds = quantity * price - transactionFee
    const remainingQuantity = position.quantity - quantity

    // Calculate realized profit/loss for this transaction
    const realizedPnlForThisTrade = (price - position.avgPrice) * quantity - transactionFee
    const transactionId = new mongoose.Types.ObjectId()
    const trade = await TradeModel.create({
      transactionType: 'SELL',
      symbolId,
      quantity,
      price,
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
      userIp
    })

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

      await PositionModel.updateOne({ _id: position._id }, update)

      // Update user balance
      user.balance += saleProceeds
      await UserModel.updateOne({ _id: userId }, { balance: user.balance })

      // Update user's watchlist
      await MyWatchList.updateOne(
        { userId: ObjectId(userId), key: stock.key },
        { quantity: remainingQuantity, avgPrice: update.avgPrice }
      )
    } else {
      await redisClient.set(`SELL_${stock.key}_${price}_${transactionId}`)
    }

    return res.status(200).json({
      status: 200,
      message: 'Sell trade processed successfully.',
      data: trade
    })
  }

  async modifyPendingTrade(req, res) {
    const {
      quantity, // New quantity
      price, // New price
      orderType, // New order type (e.g., MARKET, LIMIT)
      transactionFee = 0, // Optional transaction fee
      lot = 1 // Optional lot size
    } = req.body

    const { id: userId } = req.admin // User/Admin making the request
    const { id: tradeId } = req.params
    const userIp = getIp(req)

    try {
      // Fetch trade and user data
      const [trade, user] = await Promise.all([
        TradeModel.findById(tradeId).lean(),
        UserModel.findById(userId).lean()
      ])
      if (!trade) {
        return res.status(404).json({ status: 404, message: 'Trade not found.' })
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

      if (orderType === 'MARKET') {
        updateData.executionStatus = 'EXECUTED'
        updateData.triggeredAt = new Date()
      }

      // Update the trade in the database
      const updatedTrade = await TradeModel.findByIdAndUpdate(tradeId, { $set: updateData }, { new: true })

      if (orderType === 'MARKET') {
        if (trade.transactionType === 'BUY') {
          // Deduct balance
          await redisClient.del(`BUY_${stock.key}_${price}_${trade.transactionId}`)
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
          await redisClient.del(`SELL_${stock.key}_${price}_${trade.transactionId}`)
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
          const saleProceeds = quantity * price - transactionFee
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
          await redisClient.set(`BUY_${stock.key}_${price}_${trade.transactionId}`)
        } else if (trade.transactionType === 'SELL') {
          await redisClient.set(`SELL_${stock.key}_${price}_${trade.transactionId}`)
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
      const trade = await TradeModel.findById(tradeId).lean()

      if (!trade) {
        return res.status(404).json({ status: 404, message: 'Trade not found.' })
      }

      if (trade.executionStatus !== 'PENDING') {
        return res.status(400).json({ status: 400, message: 'Only pending trades can be canceled.' })
      }

      if (trade.userId.toString() !== userId.toString()) {
        return res.status(403).json({ status: 403, message: 'You do not have permission to cancel this trade.' })
      }

      // Update the trade status to CANCELED
      await TradeModel.findByIdAndUpdate(tradeId, { executionStatus: 'CANCELED', remarks: 'Trade canceled by user.', userIp })
      await redisClient.del(`${trade.orderType}_${trade.key}_${trade.price}_${trade.transactionId}`)
      return res.status(200).json({ status: 200, message: 'Trade canceled successfully.' })
    } catch (error) {
      console.error('Error canceling trade:', error)
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
        .populate('userId') // Populate specific fields

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
}

module.exports = new OrderService()

async function completeBuyOrder() {
  let data
  try {
    // Pop the next executed buy order from the queue
    data = await queuePop('EXECUTED_BUY')

    if (!data) {
      // If there's no data, wait for the next cycle (retry)
      return setTimeout(completeBuyOrder, 1000)
    }

    // Parse the data
    const { transactionId } = JSON.parse(data)

    // Fetch trade details based on transaction ID
    const trade = await TradeModel.findOne({ transactionId: ObjectId(transactionId), executionStatus: 'PENDING' }).lean()

    if (!trade) {
      // If no trade is found, retry
      console.log(`No trade found for transactionId: ${transactionId}`)
      return setTimeout(completeBuyOrder, 1000)
    }

    const { userId, symbolId, quantity, price, transactionFee, lot } = trade

    // Fetch user and stock details
    const [user, stock] = await Promise.all([
      UserModel.findOne({ _id: userId }).lean(),
      SymbolModel.findOne({ _id: symbolId }).lean()
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
      setTimeout(completeBuyOrder, 1000)
      return
    }

    // Deduct balance from user
    await redisClient.del(`BUY_${stock.key}_${price}_${trade.transactionId}`)
    user.balance -= transactionAmount
    await UserModel.updateOne({ _id: userId }, { balance: user.balance })

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
        { avgPrice: newAvgPrice, quantity: newQuantity, lot: newLot }
      )

      // Update the user's watchlist with the new position data
      await MyWatchList.updateOne(
        { userId: ObjectId(userId), key: stock.key },
        { avgPrice: newAvgPrice, quantity: newQuantity }
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
      })

      // Update the user's watchList with the new position data
      await MyWatchList.updateOne(
        { userId: ObjectId(userId), key: stock.key },
        { avgPrice: price, quantity }
      )
    }

    // Update the trade status to EXECUTED
    await TradeModel.updateOne({ _id: trade._id }, { executionStatus: 'EXECUTED', remarks: 'Trade executed successfully.' })

    console.log(`Executed BUY trade for transactionId: ${transactionId} successfully.`)

    // Continue processing the next buy order
    return completeBuyOrder() // Recursive call to continue processing
  } catch (error) {
    // Log the error and send the failed data to the dead-letter queue
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
    // Pop the next executed sell order from the queue
    data = await queuePop('EXECUTED_SELL')

    if (!data) {
      // If there's no data, retry after 1 second
      return setTimeout(completeSellOrder, 1000)
    }

    // Parse the data from the queue
    const { transactionId } = JSON.parse(data)

    // Fetch trade details based on transaction ID
    const trade = await TradeModel.findOne({ transactionId: ObjectId(transactionId), executionStatus: 'PENDING' }).lean()

    if (!trade) {
      console.log(`No trade found for transactionId: ${transactionId}`)
      return setTimeout(completeSellOrder, 1000) // Retry after 1 second
    }

    const {
      userId,
      symbolId,
      quantity,
      price,
      transactionFee,
      orderType,
      lot
    } = trade

    // Fetch user and stock details
    const [user, stock] = await Promise.all([
      UserModel.findOne({ _id: userId }).lean(),
      SymbolModel.findOne({ _id: symbolId }).lean()
    ])

    // Check if the user has an open position for the stock
    const position = await PositionModel.findOne({
      userId: ObjectId(userId),
      key: stock.key,
      status: 'OPEN'
    }).lean()

    if (!position || position.quantity < quantity) {
      // Insufficient stock quantity to sell
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
      setTimeout(completeSellOrder, 1000) // Retry after 1 second
      return
    }

    // Calculate sale proceeds and realized profit/loss
    const saleProceeds = quantity * price - transactionFee
    const remainingQuantity = position.quantity - quantity
    const realizedPnlForThisTrade = (price - position.avgPrice) * quantity - transactionFee

    const transactionIdNew = new mongoose.Types.ObjectId()
    await TradeModel.create({
      transactionType: 'SELL',
      symbolId,
      quantity,
      price,
      orderType,
      transactionFee,
      userId,
      executionStatus: orderType === 'MARKET' ? 'EXECUTED' : 'PENDING',
      totalValue: quantity * price,
      triggeredAt: orderType === 'MARKET' ? new Date() : null,
      lot,
      remarks: orderType === 'MARKET' ? 'Order executed successfully' : '',
      realizedPnl: realizedPnlForThisTrade, // Store P&L for this trade
      transactionId: transactionIdNew
    })

    const update = remainingQuantity === 0
      ? { quantity: 0, status: 'CLOSED', closeDate: Date.now() }
      : { quantity: remainingQuantity }

    // Update total value and realized P&L
    update.totalValue = remainingQuantity === 0
      ? 0
      : position.avgPrice * remainingQuantity

    update.realizedPnl = (position.realizedPnl || 0) + realizedPnlForThisTrade

    // Update other fields like avgPrice and lot
    update.avgPrice = remainingQuantity === 0 ? 0 : position.avgPrice
    update.lot = position.lot + lot

    // Update the position in the database
    await PositionModel.updateOne({ _id: position._id }, update)

    // Update the user's balance
    user.balance += saleProceeds
    await UserModel.updateOne({ _id: userId }, { balance: user.balance })

    // Update the user's watchList
    await MyWatchList.updateOne(
      { userId: ObjectId(userId), key: stock.key },
      { quantity: remainingQuantity, avgPrice: update.avgPrice }
    )

    // Return a successful response with the trade data
    console.log(`Executed SELL trade for transactionId: ${transactionId} successfully.`)
    return completeSellOrder() // Continue processing the next sell order
  } catch (error) {
    // Handle errors by logging and pushing failed data to a dead-letter queue
    console.error('Error processing sell order:', error)
    if (data) {
      await queuePush('dead:EXECUTED_SELL', data)
    }

    // Retry after 1 second in case of failure
    return setTimeout(completeSellOrder, 1000)
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
