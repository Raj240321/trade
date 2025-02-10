const service = require('./service')
const router = require('express').Router()
const { isSuperMaster, validateAdmin } = require('../../middlewares/middleware')

router.post('/admin/quantity/create', isSuperMaster, service.createQuantity)

router.put('/admin/quantity/update/:id', isSuperMaster, service.updateQuantity)

router.delete('/admin/quantity/delete/:id', isSuperMaster, service.deleteQuantity)

router.get('/admin/quantity/getAll', validateAdmin, service.getAllQuantities)

router.get('/user/quantity/getAll', validateAdmin, service.getAllQuantities)

router.get('/admin/quantity/get/:id', validateAdmin, service.getSingleQuantity)

module.exports = router
