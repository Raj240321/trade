const Router = require('router')
const router = Router()
const services = require('./services')
const validators = require('./validators')
const { validateAdmin } = require('../../middlewares/middleware.js')

// Admin Authentication Routes
router.post('/admin/create/v1', validators.create, validateAdmin, services.createAdmin)
router.post('/admin/login/v1', validators.login, services.adminLogin)
router.post('/admin/logout/v1', validateAdmin, services.logout)

// Admin Management Routes
router.put('/admin/addBalance/v1', validators.addBalance, validateAdmin, services.addBalance)
router.put('/admin/updateInfo/v1', validators.updateInfo, validateAdmin, services.updateInfo)
router.put('/admin/changePassword/v1', validators.changePassword, validateAdmin, services.changePassword)

// Admin Listing Route
router.get('/admin/list/v1', validators.listAdmin, validateAdmin, services.listAdmin)

// Get Admin Info Route
router.get('/admin/getInfo/:code/v1', validators.getInfo, validateAdmin, services.getInfo)

module.exports = router
