const router = require('express').Router()
const scriptServices = require('./services')
const validators = require('./validators')
const { validateAdmin, isSuperMaster } = require('../../middlewares/middleware')

router.post('/admin/script/create', validators.addSingle, validateAdmin, isSuperMaster, scriptServices.addSingle)
router.post('/admin/script/bulkCreate', validators.addBulk, validateAdmin, isSuperMaster, scriptServices.addBulk)
router.put('/admin/script/update/:id', validators.updatescript, isSuperMaster, scriptServices.update)
router.delete('/admin/script/delete/:id', validators.deletescript, isSuperMaster, scriptServices.delete)
router.get('/admin/script/get/:id', validators.getscript, validateAdmin, scriptServices.get)
router.get('/admin/script/list', validators.listscripts, validateAdmin, scriptServices.list)

module.exports = router
