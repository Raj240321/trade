const { body, query, param } = require('express-validator')

const addTrade = [
  body('transactionType')
    .not()
    .isEmpty()
    .isIn(['BUY', 'SELL'])
    .withMessage('Transaction type must be either "BUY" or "SELL"'),
  body('symbolId')
    .not()
    .isEmpty()
    .isMongoId()
    .withMessage('Valid symbol ID is required'),
  body('quantity')
    .not()
    .isEmpty()
    .isInt({ min: 1 })
    .withMessage('Quantity must be a positive integer greater than 0'),
  body('price')
    .not()
    .isEmpty()
    .isFloat({ min: 0 })
    .withMessage('Price must be a positive number'),
  body('lot')
    .optional()
    .isNumeric()
    .withMessage('lot must be a Numeric if provided'),
  body('transactionFee')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Transaction fee must be a positive number if provided'),
  body('orderType')
    .not()
    .isEmpty()
    .isIn(['MARKET', 'LIMIT', 'STOP-LOSS', 'STOP-LIMIT'])
    .withMessage('Order type must be either "MARKET", "LIMIT", "STOP-LOSS", or "STOP-LIMIT"')
]

const updateTrade = [
  body('quantity')
    .not()
    .isEmpty()
    .isInt({ min: 1 })
    .withMessage('Quantity must be a positive integer greater than 0'),
  body('price')
    .not()
    .isEmpty()
    .isFloat({ min: 0 })
    .withMessage('Price must be a positive number'),
  body('lot')
    .optional()
    .isNumeric()
    .withMessage('lot must be a Numeric if provided'),
  body('transactionFee')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Transaction fee must be a positive number if provided'),
  body('orderType')
    .not()
    .isEmpty()
    .isIn(['MARKET', 'LIMIT', 'STOP-LOSS', 'STOP-LIMIT'])
    .withMessage('Order type must be either "MARKET", "LIMIT", "STOP-LOSS", or "STOP-LIMIT"'),
  param('id').not().isEmpty().isMongoId()
]

const cancelTrade = [
  param('id')
    .not()
    .isEmpty()
    .isMongoId()
    .withMessage('Valid ID is required')
]

const listMyTrade = [
  query('transactionType').optional().isIn(['BUY', 'SELL']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1 }),
  query('search').optional().isString(),
  query('executionStatus').optional().isIn(['PENDING', 'EXECUTED', 'CANCELLED', 'REJECTED']),
  query('order').optional().isIn([1, -1]),
  query('sort').optional().isString(),
  query('from').optional(),
  query('to').optional(),
  query('range').optional().isString(),
  query('orderType').optional().isString().isIn(['MARKET', 'LIMIT', 'STOP-LOSS'])
]

const listTradeByRole = [
  query('transactionType').optional().isIn(['BUY', 'SELL']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1 }),
  query('search').optional().isString(),
  query('executionStatus').optional().isIn(['PENDING', 'EXECUTED', 'CANCELLED', 'REJECTED']),
  query('order').optional().isIn([1, -1]),
  query('sort').optional().isString(),
  query('masterId').optional().isMongoId(),
  query('brokerId').optional().isMongoId(),
  query('userId').optional().isMongoId(),
  query('symbol').optional().isString()
]

const listMyPosition = [
  query('exchange').optional().isIn(['NSE', 'MCX']),
  query('type').optional().isString().isIn(['FUTCOM', 'FUTSTK', 'INDICES', 'FUTIDX']),
  query('status').optional().isIn(['OPEN', 'CLOSED']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1 }),
  query('search').optional().isString(),
  query('symbol').optional().isString(),
  query('sort').optional().isString(),
  query('order').optional().isIn([1, -1]),
  query('from').optional(),
  query('to').optional(),
  query('range').optional().isString()
]

const listPositionByRole = [
  query('exchange').optional().isIn(['NSE', 'MCX']),
  query('type').optional().isString().isIn(['FUTCOM', 'FUTSTK', 'INDICES', 'FUTIDX']),
  query('status').optional().isIn(['OPEN', 'CLOSED']),
  query('symbol').optional().isString(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1 }),
  query('search').optional().isString(),
  query('sort').optional().isString(),
  query('order').optional().isIn([1, -1]),
  query('masterId').optional().isDate(),
  query('brokerId').optional().isDate(),
  query('userId').optional().isString()
]

const listLedger = [
  query('transactionType').optional().isIn(['BUY', 'SELL']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1 }),
  query('search').optional().isString(),
  query('order').optional().isIn([1, -1]),
  query('sort').optional().isString()
]

const exitPosition = [
  body('symbolIds').not().isEmpty().isArray().withMessage('SymbolIds must be is in array format')
]

const rollOver = [
  body('currentSymbolId').not().isEmpty().isMongoId().withMessage('currentSymbolId must be is in objectId Format')
]

const tradeLogs = [
  query('transactionType').optional().isIn(['BUY', 'SELL']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1 }),
  query('search').optional().isString(),
  query('executionStatus').optional(),
  query('tradeId').optional()
]

module.exports = {
  addTrade,
  updateTrade,
  cancelTrade,
  listMyTrade,
  listTradeByRole,
  listMyPosition,
  listPositionByRole,
  listLedger,
  exitPosition,
  rollOver,
  tradeLogs
}
