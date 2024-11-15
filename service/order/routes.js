const router = require('express').Router()
const services = require('./service') // Assuming services are in the services file
const validators = require('./validators') // Assuming validators are in the validators file
const { validateAdmin } = require('../../middlewares/middleware') // Assuming middleware for validation

router.post('/admin/order/execute', validators.addTransaction, validateAdmin, services.executeTrade.bind(services))

// router.put('/admin/order/update/:transactionId', validators.updateOrder, validateAdmin, stockTransactionServices.updateTransactionStatus)

// router.put('/admin/order/cancel/:transactionId', validators.cancelTransaction, validateAdmin, stockTransactionServices.cancelOrder)

// router.get('/admin/order/get/:transactionId', validators.getTransactionById, validateAdmin, stockTransactionServices.getTransactionById)

// router.get('/admin/order/list', validators.filterTransactions, validateAdmin, stockTransactionServices.filterTransactions)

// // users API
// router.post('/user/order/add', validators.addTransaction, validateAdmin, stockTransactionServices.addTransaction)

// router.put('/user/order/update/:transactionId', validators.updateOrder, validateAdmin, stockTransactionServices.updateTransactionStatus)

// router.put('/user/order/cancel/:transactionId', validators.cancelTransaction, validateAdmin, stockTransactionServices.cancelOrder)

// router.get('/user/order/get/:transactionId', validators.getTransactionById, validateAdmin, stockTransactionServices.getTransactionById)

// router.get('/user/order/list', validators.filterTransactions, validateAdmin, stockTransactionServices.filterTransactions)

module.exports = router
