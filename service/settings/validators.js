const { body, query } = require('express-validator')

const adminAddSetting = [
  body('sTitle').not().isEmpty(),
  body('sKey').not().isEmpty(),
  body('nMax').not().isEmpty().isInt(),
  body('nMin').not().isEmpty().isInt(),
  body('nValue').not().isEmpty()
]

const adminUpdateSetting = [
  body('sKey').not().isEmpty()
]

const list = [
  query('limit').optional().isInt({ max: 20 })
]

module.exports = {
  adminAddSetting,
  adminUpdateSetting,
  list
}
