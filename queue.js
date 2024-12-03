/* eslint-disable no-prototype-builtins */
const axios = require('axios')
const { LOGIN_ID, PRODUCT, API_KEY } = require('./config/config')
const { redisClient } = require('./helper/redis')
const socketClusterClient = require('socketcluster-client')
const SymbolModel = require('./models/symbol.model')

let socket

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
      for await (const data of myChannel) {
        handleMessage(`SUBSCRIPTION-${channelName}`, data)
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
      const { AccessToken, Status } = res.data
      if (!Status) {
        console.log('Authentication failed, exiting.')
        return false
      }
      await redisClient.set('sessionToken', AccessToken, 'EX', 60 * 60 * 24) // Cache token for 24 hours
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

async function createSocketConnection() {
  try {
    let sessionToken = await redisClient.get('sessionToken')
    if (!sessionToken) {
      sessionToken = await createToken()
      if (!sessionToken) return false
    }

    const wsEndPoint = '116.202.165.216' // Only the hostname
    socket = socketClusterClient.create({
      hostname: wsEndPoint,
      port: 992, // Ensure port matches your WebSocket endpoint
      secure: false,
      query: {
        loginid: LOGIN_ID,
        accesstoken: sessionToken,
        product: PRODUCT
      }
    })

    return true
  } catch (err) {
    console.error('Error creating socket connection:', err.message || err)
    return false
  }
}

async function start() {
  try {
    const socketConnected = await createSocketConnection()
    if (!socketConnected) {
      console.log('Socket connection failed')
      return
    }

    const symbols = await SymbolModel.find({}, { key: 1 }).lean()
    const tickers = symbols.map((symbol) => symbol.key)
    socket.on('connect', async () => {
      console.log('Socket connected successfully')
      tickers.forEach((ticker) => {
        subscribeToChannel(socket, `${ticker}.json`)
      })
    })

    socket.on('error', (err) => {
      console.error('Socket error:', err.message || err)
    })

    socket.on('disconnect', () => {
      console.log('Socket disconnected.')
    })

    socket.on('close', () => {
      console.log('Socket connection closed.')
    })
  } catch (err) {
    console.error('Error in start:', err.message || err)
  }
}

async function updateSymbols() {
  try {
    // Fetch the session token once and cache it for reuse.
    let sessionToken = await redisClient.get('sessionToken')
    if (!sessionToken) {
      sessionToken = await createToken()
      if (!sessionToken) return false
    }

    const allSymbols = await SymbolModel.find({}, { key: 1, expiry: 1 }).sort({ expiry: 1 }).lean()

    // Iterate over each symbol and make requests with a delay
    for (const symbol of allSymbols) {
      const ur = `https://qbase1.vbiz.in/directrt/getdata?loginid=${LOGIN_ID}&product=DIRECTRTLITE&accesstoken=${sessionToken}&tickerlist=${symbol.key}.JSON`
      try {
        console.time('work')
        const res = await axios.get(ur)
        console.timeEnd('work')
        if (res.data) {
          await updateSymbol(res.data) // Process the symbol data
          console.log(`Data fetched for symbol ${symbol.key}`)
        }
      } catch (err) {
        console.error(`Error fetching data for symbol ${symbol.key}:`, err.message || err)
      }

      // Add a delay of 2 seconds between requests
      await delay(2000) // 2000 milliseconds = 2 seconds
    }
  } catch (err) {
    console.error('Error in updateSymbols:', err.message || err)
  }
}

// Delay function that returns a Promise resolving after a specified time
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

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

// updateSymbols()
module.exports = {
  start
}
