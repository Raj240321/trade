/* eslint-disable max-lines */
const TradeModel = require('../../models/trade.model')
const SymbolModel = require('../../models/symbol.model')
const UserModel = require('../../models/users.model')
const PositionModel = require('../../models/positions.model')
const TradeLogModel = require('../../models/tradelogs.model')
const MyWatchList = require('../../models/scripts.model')
const QuantityModel = require('../../models/quantity.model')
const { findSetting } = require('../settings/services')
const { BUY_EXPIRED } = require('../../config/config')
const { start } = require('../../queue')
const { ObjectId, getIp, checkMarketOpen, getMarketPrice } = require('../../helper/utilites.service')
const { redisClient, queuePop, queuePush } = require('../../helper/redis')
const mongoose = require('mongoose')
const { DBconnected } = require('../../models/db/mongodb')
class OrderService {
  // User can buy or sell there symbol future trade
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

      if (!stock || !stock.active || stock.type === 'INDICES') {
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
            { transactionType, symbolId, quantity, price: req.body.price, orderType, transactionFee, userId, lot, key: stock.key, userIp }
          )
        }
      }

      const query = {
        type: 'QTY'
      }
      if (['MIDCPNIFTY', 'NIFTYNXT50', 'NIFTY', 'FINNIFTY'].includes(stock.symbol)) {
        query.scriptType = 'NIFTY'
      } else if (stock.symbol === 'BANKNIFTY') {
        query.scriptType = 'BANKNIFTY'
      } else {
        query.qtyRangeStart = { $lte: price }
        query.qtyRangeEnd = { $gte: price }
      }
      const [quantityCheck, position] = await Promise.all([
        QuantityModel.findOne(query).lean(),
        PositionModel.findOne({
          userId: ObjectId(userId),
          key: stock.key,
          status: 'OPEN'
        }).lean()
      ])

      if (!quantityCheck) {
        return await this.rejectTrade(
          res,
          'No quantity rule found for this price range.',
          'No quantity rule found for this price range.',
          { transactionType, symbolId, quantity, price, orderType, transactionFee, userId, lot, key: stock.key, userIp }
        )
      }

      // Check if quantity is within allowed range
      if (quantity < quantityCheck.minQuantity || quantity > quantityCheck.maxQuantity) {
        return await this.rejectTrade(
          res,
          `Invalid quantity. Quantity should be min: ${quantityCheck.minQuantity}, max: ${quantityCheck.maxQuantity}`,
          'The quantity does not match the lot size.',
          { transactionType, symbolId, quantity, price, orderType, transactionFee, userId, lot, key: stock.key, userIp }
        )
      }

      // Check if max position limit is exceeded
      if (position && (position.quantity + quantity > quantityCheck.maxPosition)) {
        return await this.rejectTrade(
          res,
          `Max quantity reached. You can buy max ${quantityCheck.maxPosition - position.quantity} quantity.`,
          'Max quantity reached.',
          { transactionType, symbolId, quantity, price, orderType, transactionFee, userId, lot, key: stock.key, userIp }
        )
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
          userIp,
          position
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

  // handle buy trade logic here
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
    userIp,
    position
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
          remarks: orderType === 'MARKET' ? `Order executed successfully, Quantity ${quantity} at Price ${price}.` : '',
          transactionId,
          userIp,
          updatedBalance: orderType === 'MARKET' ? user.balance : 0
        }],
        { session }
      )

      if (orderType === 'MARKET') {
        // Update the user's balance in the database
        await UserModel.updateOne({ _id: userId }, { balance: user.balance }, { session })
        if (position && position?.status === 'OPEN') {
          // Update the existing position
          const newQuantity = position.quantity + quantity
          const newAvgPrice = (position.avgPrice * position.quantity + price * quantity) / newQuantity
          const newLot = position.lot + lot

          await PositionModel.updateOne(
            { _id: position._id },
            { avgPrice: newAvgPrice, quantity: newQuantity, lot: newLot, transactionReferences: [...position.transactionReferences, trade[0]._id.toString()] },
            { session }
          )

          // Update the user's watchlist
          await MyWatchList.updateOne(
            { userId: ObjectId(userId), key: stock.key },
            { avgPrice: newAvgPrice, quantity: newQuantity },
            { session }
          )
          await redisClient.set(`${stock.key}_${user.code}`, quantity, 'EX', BUY_EXPIRED)
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
              transactionReferences: [trade[0]._id.toString()],
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
          await redisClient.set(`${stock.key}_${user.code}`, quantity, 'EX', BUY_EXPIRED)
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

  // handle sell trade logic here
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
    const isAbleToSell = await redisClient.get(`${stock.key}_${user.code}`)
    if (isAbleToSell) {
      await this.createRejectedTrade({
        transactionType: 'SELL',
        symbolId,
        quantity,
        price,
        orderType,
        transactionFee,
        userId,
        lot,
        remarks: 'You can not sell current buying script due to restriction.',
        userIp
      })
      return res.status(400).json({ status: 400, message: 'You can not sell current buying script due to restriction.' })
    }
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
          remarks: orderType === 'MARKET' ? `Order executed successfully, Quantity ${quantity} at Price ${price}.` : '',
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
        const totalProfit = (user.nProfit || 0) + realizedPnlForThisTrade
        // Update other fields
        // update.avgPrice = remainingQuantity === 0 ? 0 : position.avgPrice
        update.lot = position.lot + lot
        update.transactionReferences = [...position.transactionReferences, trade[0]._id.toString()]
        await PositionModel.updateOne({ _id: position._id }, update, { session })

        // Update user's balance
        await UserModel.updateOne({ _id: userId }, { balance: user.balance, nProfit: totalProfit }, { session })

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

  // Modify pending trade based on trade ID
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
      const position = await PositionModel.findOne({ userId: ObjectId(userId), key: stock.key, status: 'OPEN' })

      if (trade.quantity !== quantity && trade.transactionType === 'BUY') {
        const transactionType = trade.transactionType
        const query = {
          type: 'QTY'
        }
        if (['MIDCPNIFTY', 'NIFTYNXT50', 'NIFTY', 'FINNIFTY'].includes(stock.symbol)) {
          query.scriptType = 'NIFTY'
        } else if (stock.symbol === 'BANKNIFTY') {
          query.scriptType = 'BANKNIFTY'
        } else {
          query.qtyRangeStart = { $lte: price }
          query.qtyRangeEnd = { $gte: price }
        }
        const quantityCheck = await QuantityModel.findOne(query).lean()
        if (!quantityCheck) {
          return res.status(400).json({ status: 400, message: 'Invalid quantity range.' })
        }
        // Check if quantity is within allowed range
        if (quantity < quantityCheck.minQuantity || quantity > quantityCheck.maxQuantity) {
          return await this.rejectTrade(
            res,
          `Invalid quantity. Quantity should be min: ${quantityCheck.minQuantity}, max: ${quantityCheck.maxQuantity}`,
          'The quantity does not match the lot size.',
          { transactionType, symbolId: trade.symbolId, quantity, price, orderType, transactionFee, userId, lot, key: stock.key, userIp }
          )
        }

        // Check if max position limit is exceeded
        if (position && (position.quantity + quantity > quantityCheck.maxPosition)) {
          return await this.rejectTrade(
            res,
          `Max quantity reached. You can buy max ${quantityCheck.maxPosition - position.quantity} quantity.`,
          'Max quantity reached.',
          { transactionType, symbolId: trade.symbolId, quantity, price, orderType, transactionFee, userId, lot, key: stock.key, userIp }
          )
        }
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
      const updatedTrade = await TradeModel.findByIdAndUpdate(tradeId, { $set: updateData }, { new: true }).lean()
      const logObj = {
        ...updatedTrade,
        tradeId: trade._id,
        executionStatus: 'UPDATED'
      }
      delete logObj._id
      delete logObj.__v
      delete logObj.createdAt
      delete logObj.updatedAt
      await TradeLogModel.create([logObj])

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

          if (position) {
            // Update existing position
            const newQuantity = position.quantity + quantity
            const newAvgPrice = (position.avgPrice * position.quantity + price * quantity) / newQuantity
            const newLot = position.lot + lot

            await PositionModel.updateOne(
              { _id: position._id },
              { avgPrice: newAvgPrice, quantity: newQuantity, lot: newLot, transactionReferences: [...position.transactionReferences, trade._id] }
            )
            await MyWatchList.updateOne(
              { userId: ObjectId(userId), key: stock.key },
              { avgPrice: newAvgPrice, quantity: newQuantity }
            )
          } else {
            // Create new position
            await PositionModel.create([{
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
              transactionReferences: [trade._id],
              triggeredAt: new Date(),
              userIp
            }])

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
          update.realizedPnl = remainingQuantity === 0 ? 0 : (position.realizedPnl || 0) + (price - position.avgPrice) * quantity - transactionFee
          update.transactionReferences = [...position.transactionReferences, tradeId]
          // Update user balance
          user.balance += saleProceeds
          const profit = (user.nProfit || 0) + (price - position.avgPrice) * quantity - transactionFee
          await PositionModel.updateOne({ _id: position._id }, update)
          await UserModel.updateOne({ _id: userId }, { balance: user.balance, nProfit: profit })
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

  // Cancel Trade by user or upper ones
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
        { executionStatus: 'CANCELED', remarks: 'Trade canceled by user.', userIp, deletedBy: userId, triggeredAt: new Date() },
        { new: true }
      ).lean()

      if (!updateResult) {
        return res.status(500).json({ status: 500, message: 'Failed to cancel the trade.' })
      }

      const tradeLogs = {
        ...updateResult,
        tradeId: updateResult._id,
        executionStatus: 'CANCELED'
      }
      delete tradeLogs._id
      delete tradeLogs.__v
      delete tradeLogs.createdAt
      delete tradeLogs.updatedAt
      await TradeLogModel.create([tradeLogs])
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

  // List of user trades based on userId
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

  // This is used for admin to get all trade based on role
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
        .populate('symbolId') // Populate symbol details
        .lean()

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

  // Get trade by trade id
  async tradeById(req, res) {
    try {
      const { id: transactionId } = req.params
      const trade = await TradeModel.findById({ _id: transactionId }).populate('symbolId').lean()
      if (!trade) {
        return res.status(404).json({ status: 404, message: 'Trade not found.' })
      }
      return res.status(200).json({ status: 200, message: 'Trade fetched successfully.', data: trade })
    } catch (error) {
      console.error('Error fetching trade:', error)
      return res.status(500).json({ status: 500, message: 'Something went wrong.' })
    }
  }

  // get trade Logs based on Id
  async tradeLogs(req, res) {
    try {
      const { tradeId, page = 1, limit = 10, transactionType, search, executionStatus } = req.query
      const skip = (parseInt(page) - 1) * parseInt(limit)
      const query = { userId: ObjectId(req.admin.id) }
      if (search) {
        query.$or = [
          { symbol: { $regex: search, $options: 'i' } },
          { name: { $regex: search, $options: 'i' } },
          { key: { $regex: search, $options: 'i' } }
        ]
      }
      if (transactionType) {
        query.transactionType = transactionType
      }
      if (executionStatus) {
        query.executionStatus = executionStatus
      }
      if (tradeId) {
        query.tradeId = ObjectId(tradeId)
      }
      const trades = await TradeLogModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)).lean()
      const count = await TradeLogModel.countDocuments(query)
      return res.status(200).json({
        status: 200,
        message: 'Trade Logs fetched successfully.',
        data: trades,
        count,
        currentPage: page,
        totalPages: Math.ceil(count / limit)
      })
    } catch (error) {
      console.error('Error fetching trade:', error)
      return res.status(500).json({ status: 500, message: 'Something went wrong.' })
    }
  }

  // List of user position based on userId
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
        .populate('symbolId') // Populate specific fields, e.g., symbol details
        .lean()

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

  // This is used for admin to get all position based on role
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
        .populate('symbolId') // Populate symbol details
        .lean()

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

  // Get position by position id
  async positionById(req, res) {
    try {
      const { id } = req.params
      const trade = await PositionModel.findById(id)
        .populate('symbolId')
        .populate('userId', 'name code role')
        .lean()
      if (!trade) {
        return res.status(404).json({ status: 404, message: 'Trade not found.' })
      }
      return res.status(200).json({ status: 200, message: 'Trade fetched successfully.', data: trade })
    } catch (error) {
      console.error('Error fetching trade:', error)
      return res.status(500).json({ status: 500, message: 'Something went wrong.' })
    }
  }

  // this is used for admin to get ledger report of buy sell based on roles
  async generateLedgerReport(req, res) {
    const { id, role } = req.admin // User/Admin making the request
    try {
      const { page = 1, limit = 10, search, sort = 'triggeredAt', order = -1, transactionType } = req.query

      // Initialize allowed users array
      const allAllowedUser = [ObjectId(id)]
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

  // exit open position of user
  async exitPositions(req, res) {
    const { id, code } = req.admin
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

        const isAbleToSell = await redisClient.get(`${key}_${code}`)
        if (isAbleToSell) {
          await this.createRejectedTrade({
            transactionType: 'SELL',
            symbolId,
            quantity,
            price: closingPrice,
            orderType: 'EXITPOSITION',
            transactionFee: 0,
            userId,
            lot,
            remarks: 'You can not sell current buying script due to restriction.',
            userIp
          })
          return res.status(400).json({ status: 400, message: 'You can not sell current buying script due to restriction.' })
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
              remarks: `Exit Position. Quantity ${quantity} at Price ${closingPrice}.`,
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
            update: { executionStatus: 'CANCELLED', remarks: 'Cancelled due to exit.', userIp, deletedBy: ObjectId(id), triggeredAt: new Date() }
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
          { symbolId: { $in: aSymbolId }, userId: ObjectId(id) },
          { $set: { quantity: 0, avgPrice: 0 } },
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

  // rollOver position
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
      const currentSymbol = await SymbolModel.findOne({ _id: currentSymbolObjectId, active: true }).lean()
      if (!currentSymbol) {
        return res.status(400).json({ status: 400, message: 'No active symbol.' })
      }
      if (normalizeToMidnight(currentDate).getTime() !== normalizeToMidnight(currentSymbol.expiry).getTime()) {
        return res.status(400).json({
          status: 400,
          message: 'Only today\'s expiry symbol can rollover.'
        })
      }
      let newSymbol = await SymbolModel.find({ symbol: currentSymbol.symbol, expiry: { $gt: currentSymbol.expiry }, active: true })
        .sort({ expiry: 1 })
        .limit(1)
        .lean()

      if (!newSymbol.length) {
        return res.status(400).json({ status: 400, message: 'No active symbol found.' })
      }

      newSymbol = newSymbol[0]
      const newSymbolObjectId = ObjectId(newSymbol._id)
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
      const profit = (user.nProfit || 0) + pnlFromCurrent
      if (isValidToBuy < 0) {
        return res.status(400).json({ status: 400, message: 'Insufficient balance to rollover.' })
      }

      const session = await DBconnected.startSession()
      session.startTransaction()

      try {
        // Cancel pending trades for the current symbol
        await TradeModel.updateMany(
          { symbolId: currentSymbolObjectId, userId: ObjectId(id), executionStatus: 'PENDING' },
          {
            $set: {
              executionStatus: 'CANCELLED',
              remarks: 'Cancelled due to rollover.',
              userIp,
              deletedBy: ObjectId(id),
              updatedBalance: userBalance,
              triggeredAt: new Date()
            }
          },
          { session }
        )

        // Close current position
        await PositionModel.updateMany(
          { symbolId: currentSymbolObjectId, userId: ObjectId(id), status: 'OPEN' },
          {
            $set: {
              status: 'CLOSED',
              closeDate: new Date(),
              quantity: 0,
              realizedPnl: pnlFromCurrent,
              totalValue: 0,
              userIp,
              lot: 0
            }
          },
          { session }
        )

        // Update user's balance
        await UserModel.updateOne(
          { _id: ObjectId(id) },
          { $inc: { balance: pnlFromCurrent, nProfit: profit } },
          { session }
        )

        // Record the trade for selling the current symbol
        await TradeModel.create(
          [{
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
            remarks: `Rollover. at price : ${currentSymbolPrice}`,
            updatedBalance: userBalance + pnlFromCurrent
          }],
          { session }
        )

        // Update watchlist for the current symbol
        await MyWatchList.updateMany(
          { symbolId: currentSymbolObjectId, userId: ObjectId(id) },
          { $set: { quantity: 0, avgPrice: 0 } },
          { session }
        )

        // Record the trade for buying the new symbol
        const newTrade = await TradeModel.create(
          [{
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
          }],
          { session }
        )
        // Buy the new position
        await PositionModel.create(
          [{
            symbolId: newSymbolObjectId,
            userId: ObjectId(id),
            status: 'OPEN',
            quantity: position.quantity,
            avgPrice: newSymbolPrice,
            transactionFee: position.transactionFee || 0,
            lot: position.lot || 1,
            userIp,
            key: newSymbol.key,
            marketLot: newSymbol.BSQ,
            triggeredAt: new Date(),
            name: newSymbol.name,
            expiry: newSymbol.expiry,
            type: newSymbol.type,
            exchange: newSymbol.exchange,
            symbol: newSymbol.symbol,
            transactionReferences: newTrade[0]._id.toString()
          }],
          { session }
        )

        // Deduct the required balance for the new position
        await UserModel.updateOne(
          { _id: ObjectId(id) },
          { $inc: { balance: -priceRequiredForNew } },
          { session }
        )

        // Update the watchlist for the new symbol
        await MyWatchList.updateOne(
          { symbolId: newSymbolObjectId, userId: ObjectId(id) },
          { $inc: { quantity: position.quantity, avgPrice: newSymbolPrice } },
          { session }
        )

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
      return true
    }

    // Parse the data
    const transactionId = data
    // Fetch trade details based on transaction ID
    const trade = await TradeModel.findOne({ transactionId, executionStatus: 'PENDING' }).lean()

    if (!trade) {
      console.log(`No trade found for transactionId: ${transactionId}`)
      return true // Retry after 1 second
    }

    const { userId, symbolId, quantity, price, transactionFee, lot } = trade

    // Fetch user and stock details
    const [user, stock] = await Promise.all([
      UserModel.findOne({ _id: ObjectId(userId) }).lean(),
      SymbolModel.findOne({ _id: ObjectId(symbolId), active: true }).lean()
    ])
    if (!stock) {
      console.log(`No active symbol found for transactionId: ${transactionId}`)
      await TradeModel.updateOne({ _id: trade._id }, { $set: { executionStatus: 'REJECTED', remarks: 'No active symbol found.', triggeredAt: new Date() } })
      return true
    }
    const transactionAmount = quantity * price + transactionFee

    // Check if the user has sufficient balance
    if (transactionAmount > user.balance) {
      console.log(`Insufficient balance to execute BUY trade for transactionId: ${transactionId}`)
      // Reject the trade and log it
      await TradeModel.updateOne({ _id: trade._id }, { $set: { executionStatus: 'REJECTED', remarks: 'Insufficient balance to execute BUY trade.', triggeredAt: new Date() } })
      // Retry after 1 second
      return true
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
          { avgPrice: newAvgPrice, quantity: newQuantity, lot: newLot, transactionReferences: [...position.transactionReferences, trade._id] },
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
        await PositionModel.create([{
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
          transactionReferences: [trade._id],
          triggeredAt: new Date()
        }], { session })

        // Update the user's watchList with the new position data
        await MyWatchList.updateOne(
          { userId: ObjectId(userId), key: stock.key },
          { avgPrice: price, quantity },
          { session }
        )
      }

      // Update the trade status to EXECUTED
      await TradeModel.updateOne({ _id: ObjectId(trade._id) }, { $set: { executionStatus: 'EXECUTED', remarks: `Trade executed successfully. Quantity : ${quantity} at price : ${price}.`, updatedBalance: user.balance, triggeredAt: new Date() } }, { session })
      await redisClient.set(`${stock.key}_${user.code}`, quantity, 'EX', BUY_EXPIRED)

      // Commit the transaction
      await session.commitTransaction()
      session.endSession()

      console.log(`Executed BUY trade for transactionId: ${transactionId} successfully.`)

      // Continue processing the next buy order
      return true // Recursive call to continue processing
    } catch (error) {
      // Abort the transaction in case of error
      await session.abortTransaction()
      session.endSession()

      console.error('Error processing buy order:', error)
      if (data) {
        await queuePush('dead:EXECUTED_BUY', data)
      }

      // Retry after 1 second
      return true
    }
  } catch (error) {
    console.error('Error processing buy order:', error)
    if (data) {
      await queuePush('dead:EXECUTED_BUY', data)
    }
    // Retry after 1 second
    return true
  }
}

async function completeSellOrder() {
  let data
  try {
    data = await queuePop('EXECUTED_SELL')

    if (!data) {
      return true // Retry after 1 second
    }

    const transactionId = data
    const trade = await TradeModel.findOne({ transactionId: transactionId, executionStatus: 'PENDING' }).lean()

    if (!trade) {
      console.log(`No trade found for transactionId: ${transactionId}`)
      return true // Retry after 1 second
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
      await TradeModel.updateOne({ _id: trade._id }, { $set: { executionStatus: 'REJECTED', remarks: 'Insufficient stock quantity to sell.', triggeredAt: new Date() } })
      return true // Retry after 1 second
    }

    const saleProceeds = quantity * price - transactionFee
    const remainingQuantity = position.quantity - quantity
    const realizedPnlForThisTrade = (price - position.avgPrice) * quantity - transactionFee
    const profit = (user.nProfit || 0) + realizedPnlForThisTrade

    const update = remainingQuantity === 0 ? { quantity: 0, status: 'CLOSED', closeDate: Date.now() } : { quantity: remainingQuantity }
    update.totalValue = remainingQuantity === 0 ? 0 : position.avgPrice * remainingQuantity
    update.realizedPnl = (position.realizedPnl || 0) + realizedPnlForThisTrade
    update.lot = position.lot + lot
    update.transactionReferences = [...position.transactionReferences, trade._id]
    const session = await DBconnected.startSession()
    session.startTransaction()
    try {
      await PositionModel.updateOne({ _id: position._id }, update, { session })
      await UserModel.updateOne({ _id: userId }, { balance: user.balance + saleProceeds, nProfit: profit }, { session })
      await MyWatchList.updateOne(
        { userId: ObjectId(userId), key: stock.key },
        { quantity: remainingQuantity, avgPrice: update.avgPrice },
        { session }
      )
      await TradeModel.updateOne({ _id: trade._id }, { $set: { executionStatus: 'EXECUTED', remarks: `Trade executed successfully. Quantity : ${quantity} at price : ${price}.`, updatedBalance: user.balance, triggeredAt: new Date() } }, { session })

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
      return true // Retry after 1 second
    }
  } catch (error) {
    console.error('Error processing sell order:', error)
    if (data) {
      await queuePush('dead:EXECUTED_SELL', data)
    }
    return true // Retry after 1 second
  }
}

setTimeout(() => {
  startService()
}, 2000)

setInterval(() => {
  completeBuyOrder()
  completeSellOrder()
}, 2000)

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

function normalizeToMidnight(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}
