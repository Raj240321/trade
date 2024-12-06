const router = require('express').Router()
const blockService = require('./service')
const { validateAdmin } = require('../../middlewares/middleware')

router.post('/admin/block/blockSymbol', validateAdmin, blockService.blockUser)
router.post('/admin/block/unblockSymbol', validateAdmin, blockService.unblockUser)
router.get('/admin/block/list', validateAdmin, blockService.listBlockScripts)

router.get('/admin/block/myList', validateAdmin, blockService.myBlockList)
router.get('/admin/block/get/:id', validateAdmin, blockService.getBlockById)

router.get('/user/block/myList', validateAdmin, blockService.myBlockList)
router.get('/user/block/get/:id', validateAdmin, blockService.getBlockById)

module.exports = router
