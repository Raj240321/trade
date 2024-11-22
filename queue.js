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

      await redisClient.set('sessionToken', sessionToken, 'EX', 60 * 60 * 24) // Cache token for 24 hours
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

module.exports = {
  start
}
