const router = require('express').Router()
const scriptServices = require('./services')
const validators = require('./validators')
const { validateAdmin } = require('../../middlewares/middleware')

router.post('/admin/watchList/add', validators.add, validateAdmin, scriptServices.addWatchList)
router.post('/admin/watchList/remove', validators.add, validateAdmin, scriptServices.removeWatchList)
router.get('/admin/watchList/get/:id', validators.get, validateAdmin, scriptServices.getById)
router.get('/admin/watchList/list', validators.list, validateAdmin, scriptServices.filterWatchList)

router.get('/user/watchList/get/:id', validators.get, validateAdmin, scriptServices.getById)
router.get('/user/watchList/list', validators.list, validateAdmin, scriptServices.filterWatchList)

module.exports = router
