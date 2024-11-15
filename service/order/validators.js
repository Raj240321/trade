const { body, query, param } = require('express-validator')

const addTransaction = [
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
  body('stopLossPrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Stop loss price must be a positive number if provided'),
  body('targetPrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Target price must be a positive number if provided'),
  body('lot')
    .optional()
    .isInt({ min: 1 })
    .withMessage('lot must be a positive integer if provided'),
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

const filterTransactions = [
  query('transactionType').optional().isIn(['BUY', 'SELL']).withMessage('Invalid transaction type'),
  query('symbol').optional().isString().withMessage('Symbol must be a string'),
  query('startDate').optional().isDate().withMessage('Start date must be a valid date'),
  query('endDate').optional().isDate().withMessage('End date must be a valid date'),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('sort')
    .optional()
    .isIn(['transactionDate', 'price', 'quantity'])
    .withMessage('Sort field must be one of "transactionDate", "price", or "quantity"'),
  query('order').optional().isIn([1, -1]).withMessage('Order must be 1 (ascending) or -1 (descending)')
]

const updateOrder = [
  param('transactionId')
    .not()
    .isEmpty()
    .isMongoId()
    .withMessage('Valid transaction ID is required'),
  body('executionStatus')
    .not()
    .isEmpty()
    .isIn(['PENDING', 'EXECUTED', 'CANCELLED'])
    .withMessage('Execution status must be "PENDING", "EXECUTED", or "CANCELLED"'),
  body('filledQuantity')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Filled quantity must be a positive integer if provided')
]

const cancelTransaction = [
  param('transactionId')
    .not()
    .isEmpty()
    .isMongoId()
    .withMessage('Valid transaction ID is required')
]

const bulkUpdateTransactions = [
  body('transactionIds')
    .isArray()
    .withMessage('Transaction IDs must be an array')
    .notEmpty()
    .withMessage('Transaction IDs cannot be empty'),
  body('updateData')
    .not()
    .isEmpty()
    .withMessage('Update data is required')
    .custom((value) => {
      if (!value.executionStatus) {
        throw new Error('Execution status is required in update data')
      }
      if (!['PENDING', 'EXECUTED', 'CANCELLED'].includes(value.executionStatus)) {
        throw new Error('Invalid execution status')
      }
      return true
    })
]

const getTransactionById = [
  param('transactionId')
    .not()
    .isEmpty()
    .isMongoId()
    .withMessage('Valid transaction ID is required')
]

module.exports = {
  addTransaction,
  filterTransactions,
  updateOrder,
  cancelTransaction,
  bulkUpdateTransactions,
  getTransactionById
}
