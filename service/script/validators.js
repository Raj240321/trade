const { body, query, param } = require('express-validator')

const addSingle = [
  body('exchange').not().isEmpty().isString(),
  body('type').not().isEmpty().isString(),
  body('commodity').not().isEmpty().isString(),
  body('expiryDateInString').not().isEmpty().isString(),
  body('strikePrice').optional().isNumeric({ min: 1 }),
  body('optionType').optional().isString(),
  body('additionalData').optional().isObject(),
  body('key').not().isEmpty().isString(),
  body('active').optional().isBoolean()
]

const addBulk = [
  body('scripts').isArray({ min: 1 }).withMessage('scripts array is required and cannot be empty.'),
  body('scripts.*.exchange').not().isEmpty().isString(),
  body('scripts.*.type').not().isEmpty().isString(),
  body('scripts.*.commodity').not().isEmpty().isString(),
  body('scripts.*.expiryDateInString').not().isEmpty().isString(),
  body('scripts.*.strikePrice').optional().isNumeric({ min: 1 }),
  body('scripts.*.optionType').optional().isString(),
  body('scripts.*.additionalData').optional().isObject(),
  body('scripts.*.key').not().isEmpty().isString(),
  body('scripts.*.active').optional().isBoolean()
]

const updatescript = [
  param('id').not().isEmpty().isMongoId(),
  body('exchange').optional().isString(),
  body('type').optional().isString(),
  body('commodity').optional().isString(),
  body('expiryDate').optional(),
  body('expiryDateInString').optional().isString(),
  body('strikePrice').optional().isNumeric({ min: 1 }),
  body('optionType').optional().isString(),
  body('additionalData').optional().isObject(),
  body('key').optional().isString(),
  body('active').optional().isBoolean()
]

const listscripts = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('search').optional().isString(),
  query('sort').optional().isIn(['createdAt', 'expiryDate', 'otherField']).withMessage('Invalid sort field'),
  query('exchange').optional().isString(),
  query('expiryDate').optional().toDate(),
  query('type').optional().isString(),
  query('optionType').optional().isString(),
  query('active').optional().isBoolean().toBoolean()
]

const getscript = [
  param('id').not().isEmpty().isMongoId().withMessage('Valid script ID is required')
]

const deletescript = [
  param('id').not().isEmpty().isMongoId().withMessage('Valid script ID is required')
]

module.exports = {
  addSingle,
  addBulk,
  updatescript,
  listscripts,
  getscript,
  deletescript
}
