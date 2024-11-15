const { body, query, param } = require('express-validator')

const add = [
  body('keys').not().isEmpty().isArray()
]

const list = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('search').optional().isString(),
  query('sort').optional().isIn(['symbol', 'lastPrice', 'change', 'pChange']),
  query('order').optional().isIn([1, -1]),
  query('exchange').optional().isString(),
  query('expiry').optional().toDate(),
  query('type').optional().isString(),
  query('symbol').optional().isString()
]

const get = [
  param('id').not().isEmpty().isMongoId()
]

module.exports = {
  add,
  list,
  get
}
