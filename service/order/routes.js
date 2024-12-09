const router = require('express').Router()
const services = require('./service') // Assuming services are in the services file
const validators = require('./validators') // Assuming validators are in the validators file
const { validateAdmin } = require('../../middlewares/middleware') // Assuming middleware for validation

// order related APIs
router.post('/admin/order/execute', validators.addTrade, validateAdmin, services.executeTrade.bind(services))
router.put('/admin/order/update/:id', validators.updateTrade, validateAdmin, services.modifyPendingTrade.bind(services))
router.put('/admin/order/cancel/:id', validators.cancelTrade, validateAdmin, services.cancelPendingTrade)
router.get('/admin/order/trade/list', validators.listTradeByRole, validateAdmin, services.listTradeByRole)
router.get('/admin/order/position/list', validators.listPositionByRole, validateAdmin, services.listPositionByRole)
router.post('/user/order/execute', validators.addTrade, validateAdmin, services.executeTrade.bind(services))
router.put('/user/order/update/:id', validators.updateTrade, validateAdmin, services.modifyPendingTrade.bind(services))
router.put('/user/order/cancel/:id', validators.cancelTrade, validateAdmin, services.cancelPendingTrade)

// Trade Listing API
router.get('/admin/trade/ledger', validators.listLedger, validateAdmin, services.generateLedgerReport)
router.get('/admin/trade/list', validators.listMyTrade, validateAdmin, services.listMyTrade)
router.get('/admin/trade/get/:id', validators.cancelTrade, validateAdmin, services.tradeById)

router.get('/user/trade/list', validators.listMyTrade, validateAdmin, services.listMyTrade)
router.get('/user/trade/get/:id', validators.cancelTrade, validateAdmin, services.tradeById)

// Position Listing API
router.get('/admin/position/list', validators.listMyPosition, validateAdmin, services.listMyPosition)
router.get('/admin/position/get/:id', validators.cancelTrade, validateAdmin, services.positionById)

router.get('/user/position/list', validators.listMyPosition, validateAdmin, services.listMyPosition)
router.get('/user/position/get/:id', validators.cancelTrade, validateAdmin, services.positionById)

module.exports = router
