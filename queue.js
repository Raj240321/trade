/* eslint-disable no-prototype-builtins */
const axios = require('axios')
const schedule = require('node-schedule')
const { LOGIN_ID, PRODUCT, API_KEY } = require('./config/config')
const { redisClient } = require('./helper/redis')
const socketClusterClient = require('socketcluster-client')
const SymbolModel = require('./models/symbol.model')

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
            pipeline.set(channelName, item)
            handleMessage(`SUBSCRIPTION-${channelName}`, item)
          })
          await pipeline.exec() // Execute batch writes
        }
      }
    } catch (err) {
      console.error(`Error subscribing to channel "${ticker}":`, err)
    }
  })()
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

    const symbols = await SymbolModel.find({}, { key: 1 }).sort({ expiry: 1 }).lean()
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

async function updateSymbols() {
  try {
    // Fetch the session token once and cache it for reuse.
    // let sessionToken = await redisClient.get('sessionToken')
    // if (!sessionToken) {
    //   sessionToken = await createToken()
    //   if (!sessionToken) return false
    // }

    // const allSymbols = await SymbolModel.find({}, { key: 1, expiry: 1 }).sort({ expiry: 1 }).lean()

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
    const { Open, High, Low, PrevClose, DayOpen, DayLowest, DayHighest, LTP, StrikePrice, BSP, BBP, UniqueName, ATP } = data
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

schedule.scheduleJob('30 15 * * *', async function () {
  try {
    await updateSymbols()
  } catch (error) {
    console.log('error', error)
  }
})

module.exports = {
  start
}

var socket
