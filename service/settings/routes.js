const router = require('express').Router()
const settingServices = require('./services')
const validators = require('./validators')
const { validateAdmin, isSuperMaster } = require('../../middlewares/middleware')
const { cacheRoute } = require('../../helper/redis')

router.post('/admin/setting', validateAdmin, isSuperMaster, settingServices.add)
router.put('/admin/setting/:id', validateAdmin, isSuperMaster, settingServices.update)
router.delete('/admin/setting/:id', validateAdmin, isSuperMaster, settingServices.deleteSetting)

router.get('/admin/setting/list', validators.list, validateAdmin, settingServices.list)
router.get('/admin/setting/:id', validateAdmin, settingServices.get)

router.get('/user/setting/keyWise', settingServices.getSettingByKey)
router.get('/user/setting/list', validators.list, cacheRoute(60), settingServices.list)

module.exports = router
