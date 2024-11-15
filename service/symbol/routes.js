const router = require('express').Router()
const symbolService = require('./service')
const validators = require('./validators')
const { validateAdmin, isSuperMaster } = require('../../middlewares/middleware')

router.post('/admin/symbol/create', validators.createSymbol, validateAdmin, isSuperMaster, symbolService.createSymbol)
router.post('/admin/symbol/remove', validators.deleteSymbol, validateAdmin, isSuperMaster, symbolService.removeSymbol)

router.get('/admin/symbol/list', validators.listSymbol, validateAdmin, symbolService.listSymbol)
router.get('/admin/symbol/get/:id', validators.getSymbol, validateAdmin, symbolService.getSymbol)

// users API routes
router.get('/user/symbol/list', validators.listSymbol, validateAdmin, symbolService.listSymbol)
router.get('/user/symbol/get/:id', validators.getSymbol, validateAdmin, symbolService.getSymbol)

module.exports = router
