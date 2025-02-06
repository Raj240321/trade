const customEventEmitter = require('./helper/eventemitter') // Import the event emitter
const { isUserSocketAuthenticated } = require('./middlewares/middleware')

module.exports = (io) => {
  try {
    io.use(isUserSocketAuthenticated)
    io.on('connection', (socket) => {
      console.log('New client connected')

      // Handle subscription requests from clients
      socket.on('subscribe', (channel) => {
        console.log(`Client subscribed to channel: ${channel}`)
        socket.join(channel) // Join the socket.io room (channel)

        // Send confirmation to the client
        socket.emit('message', `Subscribed to channel: ${channel}`)
      })

      // Handle client disconnection
      socket.on('disconnect', () => {
        console.log('Client disconnected')
      })
    })

    // Listen for events from the event emitter and send data to clients
    customEventEmitter.on('tickerData', ({ channel, data }) => {
      // console.log(`Broadcasting data to channel: ${channel}`)
      io.emit(channel, data) // Send data to clients subscribed to this channel
    })
  } catch (error) {
    console.error(error)
  }
}
