const TradeModel = require('../../models/trade.model')
const SymbolModel = require('../../models/symbol.model')
const UserModel = require('../../models/users.model')
const PositionModel = require('../../models/positions.model')
const MyWatchList = require('../../models/scripts.model')

class StockTransactionService {
  async executeTrade(req, res) {
    const {
      transactionType, // BUY or SELL
      symbolId, // Stock identifier
      quantity,
      price,
      stopLossPrice = 0,
      targetPrice = 0,
      orderType = 'MARKET', // Defaults to MARKET
      transactionFee = 0,
      lot = 1
    } = req.body

    const { id: userId } = req.admin // User/Admin making the request
    const transactionAmount = quantity * price + transactionFee

    try {
      // Validate user existence and activity
      const user = await UserModel.findById(userId).lean()
      if (!user || !user.isActive) {
        await this.createRejectedTrade({
          transactionType,
          symbolId,
          quantity,
          price,
          stopLossPrice,
          targetPrice,
          orderType,
          transactionFee,
          userId,
          executionStatus: 'REJECTED',
          lot,
          remarks: 'Your account is not active, please try again.'
        })
        return res.status(404).json({ status: 404, message: 'User not found or inactive.' })
      }

      // Validate stock existence and activity
      const stock = await SymbolModel.findById(symbolId).lean()
      if (!stock || !stock.active) {
        await this.createRejectedTrade({
          transactionType,
          symbolId,
          quantity,
          price,
          stopLossPrice,
          targetPrice,
          orderType,
          transactionFee,
          userId,
          lot,
          key: stock ? stock.key : '',
          remarks: 'Stock not found or inactive.'
        })
        return res.status(404).json({ status: 404, message: 'Stock not found or inactive.' })
      }

      // Route trade type
      if (transactionType === 'BUY') {
        return await this.handleBuyTrade({
          user,
          stock,
          transactionAmount,
          quantity,
          price,
          stopLossPrice,
          targetPrice,
          orderType,
          transactionFee,
          symbolId,
          lot,
          userId,
          res
        })
      }

      if (transactionType === 'SELL') {
        return await this.handleSellTrade({
          user,
          stock,
          quantity,
          price,
          transactionFee,
          stopLossPrice,
          targetPrice,
          orderType,
          symbolId,
          lot,
          userId,
          res
        })
      }

      return res.status(400).json({ status: 400, message: 'Invalid transaction type.' })
    } catch (error) {
      console.error('Error executing trade:', error)
      await this.createRejectedTrade({
        transactionType,
        symbolId,
        quantity,
        price,
        stopLossPrice,
        targetPrice,
        orderType,
        transactionFee,
        userId,
        lot,
        remarks: 'Something went wrong.'
      })
      return res.status(500).json({ status: 500, message: 'Something went wrong.' })
    }
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
    stopLossPrice,
    targetPrice,
    orderType,
    transactionFee,
    symbolId,
    lot,
    userId,
    res
  }) {
    // Check balance
    if (transactionAmount > user.balance) {
      await this.createRejectedTrade({
        transactionType: 'BUY',
        symbolId,
        quantity,
        price,
        stopLossPrice,
        targetPrice,
        orderType,
        transactionFee,
        userId,
        lot,
        key: stock.key,
        remarks: 'Insufficient balance for trade.'
      })
      return res.status(400).json({ status: 400, message: 'Insufficient balance for trade.' })
    }

    const trade = await TradeModel.create({
      transactionType: 'BUY',
      symbolId,
      quantity,
      price,
      stopLossPrice,
      targetPrice,
      orderType,
      transactionFee,
      userId,
      executionStatus: orderType === 'MARKET' ? 'EXECUTED' : 'PENDING',
      totalValue: transactionAmount,
      lot,
      key: stock.key,
      remarks: orderType === 'MARKET' ? 'Order executed successfully' : ''
    })

    if (orderType === 'MARKET') {
      // Update user balance
      user.balance -= transactionAmount
      await UserModel.updateOne({ _id: userId }, { balance: user.balance })

      // Manage position
      const position = await PositionModel.findOne({ userId, key: stock.key, status: 'OPEN' })

      if (position) {
        // Update existing position
        const newQuantity = position.quantity + quantity
        const newAvgPrice =
          (position.avgPrice * position.quantity + price * quantity) / newQuantity

        await PositionModel.updateOne(
          { _id: position._id },
          { avgPrice: newAvgPrice, quantity: newQuantity }
        )

        await MyWatchList.updateOne(
          { scriptId: stock._id, userId },
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
          marketLot: stock.marketLot,
          quantity,
          avgPrice: price,
          active: true,
          expiry: stock.expiry,
          scriptId: symbolId,
          lot,
          transactionReferences: trade._id
        })

        await MyWatchList.updateOne(
          { scriptId: stock._id, userId },
          { avgPrice: price, quantity }
        )
      }
    }

    return res.status(200).json({ status: 200, message: 'Buy trade processed successfully.', data: trade })
  }

  async handleSellTrade({
    user,
    stock,
    quantity,
    price,
    transactionFee,
    stopLossPrice,
    targetPrice,
    orderType,
    symbolId,
    lot,
    userId,
    res
  }) {
    const position = await PositionModel.findOne({ userId, key: stock.key, status: 'OPEN' }).lean()

    if (!position || position.quantity < quantity) {
      await this.createRejectedTrade({
        transactionType: 'SELL',
        symbolId,
        quantity,
        price,
        stopLossPrice,
        targetPrice,
        orderType,
        transactionFee,
        userId,
        lot,
        remarks: 'Insufficient stock quantity to sell.'
      })
      return res.status(400).json({ status: 400, message: 'Insufficient stock quantity to sell.' })
    }

    const saleProceeds = quantity * price - transactionFee

    const trade = await TradeModel.create({
      transactionType: 'SELL',
      symbolId,
      quantity,
      price,
      stopLossPrice,
      targetPrice,
      orderType,
      transactionFee,
      userId,
      executionStatus: orderType === 'MARKET' ? 'EXECUTED' : 'PENDING',
      totalValue: quantity * price,
      lot,
      remarks: orderType === 'MARKET' ? 'Order executed successfully' : ''
    })

    if (orderType === 'MARKET') {
      const remainingQuantity = position.quantity - quantity
      const updatedData = remainingQuantity === 0
        ? { quantity: 0, status: 'CLOSED' }
        : { quantity: remainingQuantity }

      await PositionModel.updateOne({ _id: position._id }, updatedData)

      await MyWatchList.updateOne(
        { scriptId: stock._id, userId },
        { avgPrice: remainingQuantity > 0 ? position.avgPrice : 0, quantity: remainingQuantity }
      )

      user.balance += saleProceeds
      await UserModel.updateOne({ _id: userId }, { balance: user.balance })
    }

    return res.status(200).json({ status: 200, message: 'Sell trade processed successfully.', data: trade })
  }

  async modifyPendingTrade(req, res) {
    const {
      quantity, // New quantity
      price, // New price
      stopLossPrice, // Optional new stop-loss price
      targetPrice, // Optional new target price
      orderType, // New order type (e.g., MARKET, LIMIT)
      transactionFee = 0, // Optional transaction fee
      lot = 1 // Optional lot size
    } = req.body

    const { id: userId } = req.admin // User/Admin making the request
    const { id: tradeId } = req.params

    try {
      // Validate trade existence and status
      const trade = await TradeModel.findById(tradeId).lean()

      const user = await UserModel.findById(userId).lean()
      if (!trade) {
        return res.status(404).json({ status: 404, message: 'Trade not found.' })
      }

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
          stopLossPrice,
          targetPrice,
          orderType,
          transactionFee,
          userId,
          lot,
          key: trade.key,
          remarks: 'Insufficient balance to execute BUY trade.'
        })
        return res.status(400).json({ status: 400, message: 'Insufficient balance to execute BUY trade.' })
      }

      // Prepare the updated trade details
      const updateData = {
        quantity,
        price,
        stopLossPrice,
        targetPrice,
        orderType,
        transactionFee,
        lot,
        totalValue: quantity * price + transactionFee
      }

      // If the orderType is changed to MARKET, execute the trade immediately
      if (orderType === 'MARKET') {
        updateData.executionStatus = 'EXECUTED'
        updateData.triggeredAt = new Date()
      }

      // Update the trade with new details
      const updatedTrade = await TradeModel.findByIdAndUpdate(tradeId, { $set: updateData }, { new: true })

      // If orderType is MARKET, process the trade immediately
      if (orderType === 'MARKET') {
        if (trade.transactionType === 'BUY') {
          // Handle positions for BUY trade
          const stock = await SymbolModel.findById(trade.symbolId).lean()
          await this.handleBuyTrade({
            user,
            stock,
            transactionAmount,
            quantity,
            price,
            stopLossPrice,
            targetPrice,
            orderType,
            transactionFee,
            symbolId: trade.symbolId,
            lot,
            userId,
            res
          })
        } else if (trade.transactionType === 'SELL') {
          // For SELL trades, ensure that the user has sufficient stock quantity
          const position = await PositionModel.findOne({ userId, key: trade.key, status: 'OPEN' }).lean()
          if (!position || position.quantity < quantity) {
            return res.status(400).json({ status: 400, message: 'Insufficient stock quantity to execute SELL trade.' })
          }

          const saleProceeds = quantity * price - transactionFee

          // Deduct from the position and update balance for SELL
          const remainingQuantity = position.quantity - quantity
          const updatedData = remainingQuantity === 0
            ? { quantity: 0, status: 'CLOSED' }
            : { quantity: remainingQuantity }

          await PositionModel.updateOne({ _id: position._id }, updatedData)
          await MyWatchList.updateOne(
            { scriptId: trade.symbolId, userId },
            { avgPrice: remainingQuantity > 0 ? position.avgPrice : 0, quantity: remainingQuantity }
          )

          user.balance += saleProceeds
          await UserModel.updateOne({ _id: userId }, { balance: user.balance })

          // Update MyWatchList for SELL trade
          await MyWatchList.updateOne(
            { scriptId: trade.symbolId, userId },
            { avgPrice: position.avgPrice, quantity: remainingQuantity } // Update with new avgPrice and remaining quantity
          )
        }
      }

      // Update MyWatchList when trade is modified (even for pending trades)
      await MyWatchList.updateOne(
        { scriptId: trade.symbolId, userId },
        { avgPrice: price, quantity } // Update with new avgPrice and quantity
      )

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
}

module.exports = new StockTransactionService()
