const Router = require('router')
const router = Router()
const services = require('./services')
const validators = require('./validators')
const { validateAdmin } = require('../../middlewares/middleware.js')

// Admin Authentication Routes
router.post('/admin/create', validators.create, validateAdmin, services.createAdmin)
router.post('/admin/login', validators.login, services.adminLogin)
router.post('/admin/logout', validateAdmin, services.logout)
router.post('/user/login', validators.login, services.userLogin)
router.post('/user/logout', validateAdmin, services.logout)

// Admin Management Routes
router.put('/admin/addBalance', validators.addBalance, validateAdmin, services.addBalance)
router.put('/admin/withdrawBalance', validators.addBalance, validateAdmin, services.withdrawBalance)
router.put('/admin/updateInfo', validators.updateInfo, validateAdmin, services.updateInfo)
router.put('/admin/changePassword', validators.changePassword, validateAdmin, services.changePassword)
router.put('/user/changePassword', validators.changePassword, validateAdmin, services.changePassword)

// Admin Listing Route
router.get('/admin/list', validators.listAdmin, validateAdmin, services.listAdmin)
router.get('/admin/getProfile', validateAdmin, services.getProfile)
router.get('/user/getProfile', validateAdmin, services.getProfile)

// Get Admin Info Route
router.get('/admin/getInfo/:code', validators.getInfo, validateAdmin, services.getInfo)

module.exports = router
