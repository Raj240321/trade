const router = require('express').Router()
const scriptServices = require('./services')
const validators = require('./validators')
const { validateAdmin, isSuperMaster } = require('../../middlewares/middleware')

router.post('/admin/create', validators.addSingle, isSuperMaster, scriptServices.addSingle)
router.post('/admin/bulkCreate', validators.addBulk, isSuperMaster, scriptServices.addBulk)
router.put('/admin/update/:id', validators.updatescript, isSuperMaster, scriptServices.update)
router.delete('/admin/delete/:id', validators.deletescript, isSuperMaster, scriptServices.delete)
router.get('/admin/get/:id', validators.getscript, validateAdmin, scriptServices.get)
router.get('/admin/list', validators.listscripts, validateAdmin, scriptServices.list)

module.exports = router
