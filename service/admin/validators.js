const { body, query, param } = require('express-validator')

const create = [
  body('name').not().isEmpty().isLength({ max: 40 }),
  body('password').not().isEmpty().isLength({ min: 8 }),
  body('limit').not().isEmpty().isNumeric({ min: 1 }),
  body('balanceLimit').not().isEmpty().isNumeric({ min: 1 })
]

const login = [
  body('code').not().isEmpty(),
  body('password').not().isEmpty()
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

const additionalInfo = [
  body('code').not().isEmpty(),
  body('highToLow').not().isEmpty().isBoolean(),
  body('intraDay').not().isEmpty().isBoolean(),
  body('m2mLinkLedger').not().isEmpty().isBoolean(),
  body('bandScript').not().isEmpty().isBoolean(),
  body('HR3sqOff').not().isEmpty().isBoolean(),
  body('autoSquare').not().isEmpty().isBoolean(),
  body('positionSquareOff').not().isEmpty().isBoolean(),
  body('viewAccess').not().isEmpty().isBoolean(),
  body('btEnabled').not().isEmpty().isBoolean(),
  body('sqOfDisableMinutes').not().isEmpty().isNumeric({ min: 0 }),
  body('orderLimit').not().isEmpty().isNumeric({ min: 0, max: 100 }),
  body('alert').not().isEmpty().isNumeric({ min: 0, max: 100 }),
  body('m2mProfit').not().isEmpty().isNumeric(),
  body('m2mLoss').not().isEmpty().isNumeric(),
  body('marketAccess').not().isEmpty().isArray(),
  body('userNotes').not().isEmpty().isString(),
  body('noOfBrokers').not().isEmpty().isNumeric({ min: 0 })
]

const getInfo = [
  param('code').not().isEmpty()
]

const getTransactions = [
  query('type').optional(),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  query('page').optional().isInt({ min: 1 }),
  query('sortField').optional().isString(),
  query('sortOrder').optional().isIn(['asc', 'desc']),
  query('transactionStatus').optional().isString(),
  query('search').optional().isString()
]

module.exports = {
  create,
  login,
  changePassword,
  listAdmin,
  addBalance,
  updateInfo,
  getInfo,
  additionalInfo,
  getTransactions
}
