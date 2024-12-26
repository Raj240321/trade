/* eslint-disable no-prototype-builtins */
const axios = require('axios')
const schedule = require('node-schedule')
const { LOGIN_ID, PRODUCT, API_KEY } = require('./config/config')
const { redisClient } = require('./helper/redis')
const socketClusterClient = require('socketcluster-client')
const SymbolModel = require('./models/symbol.model')
const PositionModel = require('./models/positions.model')
const UserModel = require('./models/users.model')
const TradeModel = require('./models/trade.model')
const WatchListModel = require('./models/scripts.model')
const BlockListModel = require('./models/block.model')
const { DBconnected } = require('./models/db/mongodb')

function handleMessage(channel, message) {
  // Handle incoming messages here
  console.log(`Message received from channel "${channel}":`, message)
}

function subscribeToChannel(socket, ticker) {
  (async () => {
    try {
      const channelName = `${ticker}`
      console.log(`Subscribing to channel: ${channelName}`)
      const myChannel = socket.subscribe(channelName)

      await myChannel.listener('subscribe').once()

      // Buffer for batch processing
      const buffer = []
      let lastFlushTime = Date.now()
      const FLUSH_INTERVAL_MS = 1000 // Flush buffer every second

      for await (const data of myChannel) {
        buffer.push(data)

        const now = Date.now()
        if (now - lastFlushTime >= FLUSH_INTERVAL_MS || buffer.length > 100) {
          const batch = buffer.splice(0, buffer.length) // Flush buffer
          lastFlushTime = now

          // Use Redis pipeline for batch writes
          const pipeline = redisClient.pipeline()

          batch.forEach(item => {
            // Save the symbol's latest price in a Redis Sorted Set (ZSET)
            pipeline.set(channelName, item)
            // handleMessage(`SUBSCRIPTION-${channelName}`, item)
          })

          // Execute batch write to Redis
          await pipeline.exec()

          // Handle limit and stop-loss orders separately for batch data
          await processOrders(batch)
        }
      }
    } catch (err) {
      console.error(`Error subscribing to channel "${ticker}":`, err)
    }
  })()
}

// Process limit and stop-loss orders from buffered data
async function processOrders(batchData) {
  const pipeline = redisClient.pipeline()

  for (let data of batchData) {
    data = JSON.parse(data)
    const { LTP, UniqueName } = data

    // Check and execute limit buy orders
    const buyOrderKeys = await redisClient.keys(`BUY-+${UniqueName}-+*`)
    for (const key of buyOrderKeys) {
      const [,, orderPrice, transactionId] = key.split('-+')
      if (LTP >= parseFloat(orderPrice)) {
        // Execute buy order
        console.log(`Executing BUY order for ${UniqueName} at price ${LTP}, Transaction ID: ${transactionId}`)
        pipeline.rpush('EXECUTED_BUY', transactionId)
        // Remove the order once executed
        pipeline.del(key)
      }
    }

    // Check and execute stop-loss sell orders
    const sellOrderKeys = await redisClient.keys(`SELL-+${UniqueName}-+*`)
    for (const key of sellOrderKeys) {
      const [,, orderPrice, transactionId] = key.split('-+')

      if (LTP <= parseFloat(orderPrice)) {
        // Execute sell order (stop-loss hit)
        console.log(`Executing SELL order for ${UniqueName} at price ${LTP}, Transaction ID: ${transactionId}`)
        pipeline.rpush('EXECUTED_SELL', transactionId)
        // Remove the order once executed
        pipeline.del(key)
      }
    }
  }
  // Execute the batch of order executions
  await pipeline.exec()
}

async function start() {
  try {
    let sessionToken = await redisClient.get('sessionToken')
    if (!sessionToken) {
      sessionToken = await createToken()
      if (!sessionToken) return false
    }

    const wsEndPoint = `116.202.165.216:992/directrt/?loginid=${LOGIN_ID}&accesstoken=${sessionToken}&product=${PRODUCT}`
    socket = socketClusterClient.create({
      hostname: wsEndPoint,
      path: '',
      port: 80
    })

    const symbols = await SymbolModel.find({ active: true }, { key: 1 }).sort({ expiry: 1, symbol: 1 }).lean()
    const tickers = symbols.map((symbol) => symbol.key)
    var myInterval = setInterval(function () {
      console.log('websocket connection state: ', socket.state)
      if (socket.state === 'open') {
        console.log('websocket connection is open')
        clearInterval(myInterval)
        tickers.forEach((ticker) => {
          subscribeToChannel(socket, `${ticker}.json`)
        })
      } else if (socket.state === 'closed') {
        // console.log(socket)
        console.log('websocket connection is closed. exiting')
        clearInterval(myInterval)
        // socket.disconnect();
      }
    }, 1000)
  } catch (err) {
    console.error('Error in start:', err.message || err)
  }
}

async function createToken() {
  try {
    const authEndPoint = `http://s3.vbiz.in/directrt/gettoken?loginid=${LOGIN_ID}&product=${PRODUCT}&apikey=${API_KEY}`
    const res = await axios.get(authEndPoint)

    if (res.status === 200 && res.data?.Status && res.data?.AccessToken) {
      const { AccessToken, ValidUntil, Status } = res.data

      if (!Status) {
        console.error('Authentication failed, exiting.')
        return false
      }

      const currentSeconds = Date.now() / 1000
      const inSeconds = new Date(ValidUntil).getTime() / 1000

      if (isNaN(inSeconds)) {
        console.error('Invalid expiration date format in ValidUntil:', ValidUntil)
        return false
      }

      const expSec = Math.max(0, inSeconds - currentSeconds) // Ensure no negative expiry
      await redisClient.set('sessionToken', AccessToken, 'EX', Math.ceil(expSec)) // Cache with expiry
      return AccessToken
    } else {
      console.error('Error fetching access token:', res.data || res.status)
      return false
    }
  } catch (err) {
    console.error('Error in createToken:', err.message || err)
    return false
  }
}

async function updateSymbols() {
  try {
    // Fetch the session token once and cache it for reuse.
    // let sessionToken = await redisClient.get('sessionToken')
    // if (!sessionToken) {
    //   sessionToken = await createToken()
    //   if (!sessionToken) return false
    // }

    // const allSymbols = await SymbolModel.find({ active: true }, { key: 1, expiry: 1 }).sort({ expiry: 1 }).lean()

    // // Iterate over each symbol and make requests with a delay
    // for (const symbol of allSymbols) {
    //   const ur = `https://qbase1.vbiz.in/directrt/getdata?loginid=${LOGIN_ID}&product=DIRECTRTLITE&accesstoken=${sessionToken}&tickerlist=${symbol.key}.JSON`
    //   try {
    //     console.time('work')
    //     const res = await axios.get(ur)
    //     console.timeEnd('work')
    //     if (res.data) {
    //       await updateSymbol(res.data) // Process the symbol data
    //       console.log(`Data fetched for symbol ${symbol.key}`)
    //     }
    //   } catch (err) {
    //     console.error(`Error fetching data for symbol ${symbol.key}:`, err.message || err)
    //   }

    //   // Add a delay of 2 seconds between requests
    //   await delay(2000) // 2000 milliseconds = 2 seconds
    // }
    // const allData = await redisClient.getAll('NSE_FUTSTK_*')
    // console.log('allData', allData)
    const matchingKeys = await redisClient.keys('NSE_FUTSTK_*') // Get all keys matching the pattern
    if (matchingKeys.length > 0) {
      const allData = await redisClient.mget(matchingKeys) // Get values for those keys
      for (const data of allData) {
        await updateSymbol(JSON.parse(data))
      }
    } else {
      console.log('No matching keys found')
    }
  } catch (err) {
    console.error('Error in updateSymbols:', err.message || err)
  }
}

// Delay function that returns a Promise resolving after a specified time
// function delay(ms) {
//   return new Promise(resolve => setTimeout(resolve, ms))
// }

async function updateSymbol(data) {
  try {
    const { Open, High, Low, PrevClose, DayOpen, DayLowest, DayHighest, LTP, StrikePrice, BSP, BBP, UniqueName, ATP, BSQ, BBQ } = data
    const updateObj = {
      Open,
      High,
      Low,
      closePrice: 0,
      PrevClose: PrevClose,
      lastPrice: LTP,
      StrikePrice,
      BBP,
      BSP,
      DayHighest,
      DayLowest,
      DayOpen,
      ATP,
      BSQ,
      BBQ,
      change: (LTP - PrevClose).toFixed(2),
      pChange: (((LTP - PrevClose) / PrevClose) * 100).toFixed(2)
    }
    // Perform an update for the symbol
    await SymbolModel.updateOne({ key: UniqueName }, updateObj, { new: true }).lean()
    return true
  } catch (error) {
    console.error('Error updating symbol:', error)
    return false
  }
}

async function closeAllATExpositions() {
  const session = await DBconnected.startSession()
  session.startTransaction()

  try {
    const todaysDate = new Date().toISOString().split('T')[0]

    // Fetch all expired symbols
    const expiredSymbols = await SymbolModel.find({
      expiry: { $lte: todaysDate },
      active: true
    }).lean()

    if (expiredSymbols.length === 0) {
      console.log('No expired symbols found.')
      return
    }

    // Create a Map of symbolId to symbol data for quick lookup
    const symbolMap = new Map()
    expiredSymbols.forEach(symbol => {
      symbolMap.set(symbol._id.toString(), symbol)
    })

    // Fetch all open positions for expired symbols
    const openPositions = await PositionModel.find({
      symbolId: { $in: expiredSymbols.map(symbol => symbol._id) },
      status: 'OPEN'
    }).populate('userId', '_id balance').lean()

    const tradeOperations = []
    const positionUpdates = []
    const userBalanceUpdates = []
    const pendingTradeUpdates = []

    for (const position of openPositions) {
      const { userId, quantity, avgPrice, symbolId, transactionFee, lot, key } = position
      const symbol = symbolMap.get(symbolId.toString())

      if (!symbol) {
        continue // Skip if no symbol found (though this should not happen)
      }

      const keyObject = await getMarketPrice(key) // Default to 0 if lastPrice is not available
      if (!keyObject) {
        throw new Error('closingPrice is not available')
      }
      const closingPrice = keyObject.LTP
      if (!closingPrice) {
        continue
      }
      console.log(`Closing price for symbol ${symbolId.name || symbolId._id}: ${closingPrice}`)
      // Calculate realized P&L
      const realizedPnl = (closingPrice - avgPrice) * quantity - (transactionFee || 0)

      // Prepare trade entry for the transaction
      tradeOperations.push({
        insertOne: {
          document: {
            transactionType: 'SELL',
            symbolId,
            quantity,
            price: closingPrice,
            orderType: 'MARKET',
            transactionFee: transactionFee || 0,
            userId: userId._id,
            executionStatus: 'EXECUTED',
            totalValue: quantity * closingPrice,
            triggeredAt: new Date(),
            lot: lot || 1,
            remarks: 'Auto-closed due to expiry',
            updatedBalance: userId.balance + realizedPnl
          }
        }
      })

      // Prepare position update (close position)
      positionUpdates.push({
        updateOne: {
          filter: { _id: position._id },
          update: {
            status: 'CLOSED',
            closeDate: new Date(),
            quantity: 0,
            realizedPnl,
            totalValue: 0
          }
        }
      })

      // Prepare user balance update
      userBalanceUpdates.push({
        updateOne: {
          filter: { _id: userId._id },
          update: { $inc: { balance: realizedPnl } }
        }
      })

      console.log(`Position to be closed for user ${userId._id} on symbol ${symbolId}. Realized P&L: ${realizedPnl}`)
    }

    // Fetch all pending trades for expired symbols
    const pendingTrades = await TradeModel.find({
      symbolId: { $in: expiredSymbols.map(symbol => symbol._id) },
      executionStatus: 'PENDING'
    }).lean()

    pendingTrades.forEach(trade => {
      pendingTradeUpdates.push({
        updateOne: {
          filter: { _id: trade._id },
          update: { executionStatus: 'CANCELLED', remarks: 'Cancelled due to expiry' }
        }
      })
    })

    // Execute all trade entries, position updates, user balance updates, and trade cancellations in bulk
    if (tradeOperations.length > 0) {
      await TradeModel.bulkWrite(tradeOperations, { session })
    }
    if (positionUpdates.length > 0) {
      await PositionModel.bulkWrite(positionUpdates, { session })
    }
    if (userBalanceUpdates.length > 0) {
      await UserModel.bulkWrite(userBalanceUpdates, { session })
    }
    if (pendingTradeUpdates.length > 0) {
      await TradeModel.bulkWrite(pendingTradeUpdates, { session })
    }

    // Mark all expired symbols as inactive in bulk
    await SymbolModel.updateMany(
      { _id: { $in: expiredSymbols.map(symbol => symbol._id) } },
      { $set: { active: false } },
      { session }
    )

    // Delete all expired symbols from WatchList and BlockList
    await Promise.all([
      WatchListModel.deleteMany({ symbolId: { $in: expiredSymbols.map(symbol => symbol._id) } }, { session }),
      BlockListModel.deleteMany({ scriptId: { $in: expiredSymbols.map(symbol => symbol._id) } }, { session })
    ])

    // create new expiry for all symbols
    // Commit the transaction if everything is successful
    await session.commitTransaction()

    await createNewExpiry(expiredSymbols)

    console.log('All expired symbols set to inactive, related positions closed, and pending trades cancelled.')
  } catch (error) {
    // If there is an error, abort the transaction
    await session.abortTransaction()
    console.error('Error closing expired positions:', error)
  } finally {
    // End the session
    session.endSession()
  }
}

async function createNewExpiry(expiredSymbols) {
  try {
    for (const symbolDetails of expiredSymbols) {
      const { symbol, exchange, type } = symbolDetails

      // Get the most recent expiry for the symbol
      const lastSymbolExpiry = await SymbolModel.findOne({ symbol }).sort({ expiry: -1 }).lean()

      // Check if lastSymbolExpiry exists
      if (!lastSymbolExpiry) {
        console.error(`No expiry found for symbol: ${symbol}`)
        continue
      }

      // Get the next month's expiry date
      const newExpiry = getNextMonthDate(lastSymbolExpiry.expiry)
      if (!newExpiry) {
        console.error(`Error calculating new expiry for symbol: ${symbol}`)
        continue
      }

      // Format the expiry date for NSE
      const stringExpiry = formatNSEExpiryDate(newExpiry)
      // Generate new symbol key and name
      const newKey = `${exchange}_${type}_${symbol}_${stringExpiry}`
      const newName = `${symbol} ${stringExpiry}`
      // Create the new expiry symbol
      const obj = {
        key: newKey,
        name: newName,
        symbol,
        exchange, // You might want to adjust this if exchange could vary
        type, // Same here for type
        expiry: newExpiry
      }
      await SymbolModel.create(obj)
    }
    console.log('New expiry symbols created successfully.')
  } catch (error) {
    console.error('Error creating new expiry symbols:', error)
  }
}

function getNextMonthDate(date) {
  // Parse the provided date string into a Date object
  const currentDate = new Date(date)

  // Check if the date is valid
  if (isNaN(currentDate.getTime())) {
    console.error('Invalid date passed to getNextMonthDate:', date)
    return null
  }

  // Get the current month, year, and the current weekday (0-6)
  const currentMonth = currentDate.getMonth() // 0-indexed (0 = January)
  const currentYear = currentDate.getFullYear()
  const currentDayOfWeek = currentDate.getDay() // Day of the week (0 = Sunday, 1 = Monday, etc.)

  // Add 1 to the current month (next month)
  const nextMonth = currentMonth + 1

  // If the next month is January (after December), update the year
  const nextYear = nextMonth === 12 ? currentYear + 1 : currentYear

  // Get the last day of the next month (for determining the last weekday)
  const lastDayOfNextMonth = new Date(nextYear, nextMonth + 1, 0)
  const lastDayOfWeek = lastDayOfNextMonth.getDay() // Weekday of the last day of the next month

  // Calculate the number of days from the last day of the next month to the target weekday
  const daysToSubtract = (lastDayOfWeek - currentDayOfWeek + 7) % 7

  // Subtract the necessary days to get the correct weekday in the next month
  const targetDate = new Date(lastDayOfNextMonth)
  targetDate.setDate(lastDayOfNextMonth.getDate() - daysToSubtract)

  // Adjust the time to match the original date
  targetDate.setHours(currentDate.getHours())
  targetDate.setMinutes(currentDate.getMinutes())
  targetDate.setSeconds(currentDate.getSeconds())
  targetDate.setMilliseconds(currentDate.getMilliseconds())

  return targetDate
}

function formatNSEExpiryDate(expiry) {
  const month = expiry.toLocaleString('en-US', { month: 'short' }).toUpperCase()
  const year = expiry.getFullYear() % 100
  const day = expiry.getDate()
  const monthNames = {
    jan: 'JAN',
    feb: 'FEB',
    mar: 'MAR',
    apr: 'APR',
    may: 'MAY',
    jun: 'JUN',
    jul: 'JUL',
    aug: 'AUG',
    sep: 'SEP',
    oct: 'OCT',
    nov: 'NOV',
    dec: 'DEC'
  }
  const formattedMonth = monthNames[month.toLowerCase()]
  return `${day}${formattedMonth}${year}`
}

async function getMarketPrice(key) {
  try {
    const data = await redisClient.get(`${key}.json`)
    if (data) {
      return JSON.parse(data)
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
          return res.data
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

schedule.scheduleJob('31 15 * * *', async function () {
  try {
    await updateSymbols()
  } catch (error) {
    console.log('error', error)
  }
})

schedule.scheduleJob('35 15 * * *', async function () {
  try {
    await closeAllATExpositions()
  } catch (error) {
    console.log('error', error)
  }
})

schedule.scheduleJob('45 15 * * *', async function () {
  try {
    const matchingKeys = await redisClient.keys('NSE_FUTSTK_*') // Get all keys matching the pattern
    if (matchingKeys.length > 0) {
      await redisClient.del(matchingKeys)
    } else {
      console.log('No matching keys found')
    }
  } catch (error) {
    console.log('error', error)
  }
})

module.exports = {
  start,
  createToken
}

var socket
