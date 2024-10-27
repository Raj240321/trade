const router = require('express').Router()
const settingServices = require('./services')
const validators = require('./validators')
const { validateAdmin, isSuperMaster } = require('../../middlewares/middleware')
const { cacheRoute } = require('../../helper/redis')

router.post('/admin/setting/v1', validateAdmin, isSuperMaster, settingServices.add)
router.put('/admin/setting/:id/v1', validateAdmin, isSuperMaster, settingServices.update)
router.delete('/admin/setting/:id/v1', validateAdmin, isSuperMaster, settingServices.deleteSetting)

router.get('/admin/setting/list/v1', validators.list, validateAdmin, settingServices.list)
router.get('/admin/setting/:id/v1', validateAdmin, settingServices.get)

router.get('/user/setting/keyWise/v1', settingServices.getSettingByKey)
router.get('/user/setting/list/v1', validators.list, cacheRoute(60), settingServices.list)

module.exports = router
