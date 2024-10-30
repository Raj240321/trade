const { body, query, param } = require('express-validator')

const create = [
  body('name').not().isEmpty().isLength({ max: 40 }),
  body('password').not().isEmpty().isLength({ min: 8 }),
  body('limit').not().isEmpty().isNumeric({ min: 1 }),
  body('balanceLimit').not().isEmpty().isNumeric({ min: 1 })
]

const login = [
  body('code').not().isEmpty(),
  body('password').not().isEmpty(),
  body('serverCode').not().isEmpty()
]

const changePassword = [
  body('oldPassword').not().isEmpty(),
  body('newPassword').not().isEmpty().isLength({ min: 8 })
]

const listAdmin = [
  query('type').optional().isIn(['master', 'broker', 'user']),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  query('page').optional().isInt({ min: 1 }),
  query('masterId').optional().isMongoId(),
  query('brokerId').optional().isMongoId()
]

const addBalance = [
  body('code').not().isEmpty(),
  body('amount').not().isEmpty().isNumeric({ min: 1 })
]

const updateInfo = [
  body('code').not().isEmpty(),
  body('name').optional().isLength({ max: 40 }),
  body('createLimit').optional().isNumeric({ min: 1 }),
  body('balanceLimit').optional().isNumeric({ min: 1 }),
  body('isTrade').optional().isBoolean()
]

const getInfo = [
  param('code').not().isEmpty()
]

module.exports = {
  create,
  login,
  changePassword,
  listAdmin,
  addBalance,
  updateInfo,
  getInfo
}
