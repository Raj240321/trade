const events = require('events')
const eventEmitter = new events.EventEmitter()
const customEventEmitter = {}

customEventEmitter.emit = (eventName, data) => eventEmitter.emit(eventName, data)

customEventEmitter.on = (eventName, listener) => eventEmitter.on(eventName, listener)

module.exports = customEventEmitter
