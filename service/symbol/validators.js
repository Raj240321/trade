const { body, query, param } = require('express-validator')

const createSymbol = [
  body('symbol').not().isEmpty(),
  body('exchange').not().isEmpty().isIn(['NSE', 'MCX', 'nse', 'mcx']),
  body('expiry').optional().isDate()
]

const bulkCreateSymbol = [
  body('symbols').not().isEmpty().isArray(),
  body('exchange').not().isEmpty().isIn(['NSE', 'MCX', 'nse', 'mcx']),
  body('expiry').optional().isDate()
]
const updateSymbol = [
  ...createSymbol,
  param('id').not().isEmpty().isMongoId()
]

const listSymbol = [
  query('limit').optional().isInt({ max: 100 }),
  query('exchange').optional().isIn(['NSE', 'MCX', 'nse', 'mcx']),
  query('active').optional().isBoolean(),
  query('page').optional().isInt({ min: 1 }),
  query('search').optional().isString(),
  query('expiry').optional().isDate(),
  query('type').optional().isString().isIn(['FUTCOM', 'FUTSTK'])
]

const deleteSymbol = [
  param('id').not().isEmpty().isMongoId()
]

const getSymbol = [
  param('id').not().isEmpty().isMongoId()
]

module.exports = {
  createSymbol,
  bulkCreateSymbol,
  updateSymbol,
  listSymbol,
  deleteSymbol,
  getSymbol
}
