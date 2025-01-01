/* eslint-disable require-await */
/* eslint-disable prefer-regex-literals */
/* eslint-disable array-callback-return */
/* eslint-disable no-useless-escape */
/* eslint-disable no-prototype-builtins */
/**
 * Utilities Services is for common, simple & reusable methods,
 * @method {removenull} is for removing null key:value pair from the passed object
 * @method {sendmail} is for generating trasport and sending mail with specified mailOptions Object And returns a promise ex: { from:'', to:'',subject: '', html: '' }
 */
const { randomInt, createHash, randomBytes, createCipheriv, createDecipheriv } = require('crypto')

const mongoose = require('mongoose')
const {
  S3_BUCKET_NAME,
  CLOUD_STORAGE_PROVIDER, GCS_BUCKET_NAME, AZURE_STORAGE_CONTAINER_NAME
} = require('../config/config')

// const { messages, status, jsonStatus, messagesLang } = require('./api.responses')

/**
    * Method to encrypt the given key using the given algorithm
    * @param {*} text
    * @returns encrypted string
    */
const encryptEnv = (text) => {
  const iv = randomBytes(parseInt(process.env.IV_LENGTH))
  const cipher = createCipheriv(
    process.env.ALGORITHM,
    Buffer.from(process.env.ENV_CRYPTO_KEY, 'hex'),
    iv
  )
  let encrypted = cipher.update(text)
  encrypted = Buffer.concat([encrypted, cipher.final()])
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`
}

/**
    * * Method to decrypt the encrypted values
    * @param {*} text
    * @returns decrypted string
    */
const decryptEnv = (text) => {
  if (!text) return
  const [iv, encryptedText] = text.split(':').map((part) => Buffer.from(part, 'hex'))
  const decipher = createDecipheriv(process.env.ALGORITHM, Buffer.from(process.env.ENV_CRYPTO_KEY, 'hex'), iv)
  let decrypted = decipher.update(encryptedText)
  decrypted = Buffer.concat([decrypted, decipher.final()])
  return decrypted.toString()
}

/**
 * The function `replaceSensitiveInfo` replaces sensitive information in the `body` object with hashed
 * values.
 * @param body - The `body` parameter is an object that contains various properties. The properties
 * that are being checked and modified in the `replaceSensitiveInfo` function are:
 * @returns the modified `body` object after replacing sensitive information with hashed values.
 */
const replaceSensitiveInfo = (body) => {
  let myObj
  if (body?.oOldFields) {
    myObj = body?.oOldFields
    body.oOldFields = hashBody256(myObj)
  }
  if (body?.oNewFields) {
    myObj = body?.oNewFields
    body.oNewFields = hashBody256(myObj)
  }
  if (body?.oRes?.data) {
    const myObj = body.oRes.data
    body.oRes.data = hashBody256(myObj)
  }
  return body
}

const hashBody256 = (body) => {
  for (const key in body) {
    // removed 'sMoNum' as it is already decrypted
    if (['phone', 'bankAccount', 'sNo', 'sAccountNo'].includes(key)) {
      const encryptHash = createHash('sha256').update(body[key]).digest('hex')
      body[key] = body[key].replaceAll(body[key], encryptHash)
    }
  }
  return body
}
/**
 * It'll remove all nullish, not defined and blank properties of input object.
 * @param {object}
 */
const removenull = (obj) => {
  for (const propName in obj) {
    if (obj[propName] === null || obj[propName] === undefined || obj[propName] === '') {
      delete obj[propName]
    }
  }
}

/**
 * The function `projectionFields` creates a projection object by iterating over the properties of a
 * given object and adding them to the projection if their value is not null or undefined.
 * @param body - The `body` parameter is an object that represents the data you want to project. It
 * contains key-value pairs where the key is the name of a property and the value is the value of that
 * property.
 * @returns The function `projectionFields` returns an object `projection` that contains the property
 * names from the `body` object as keys, with a value of `1` for each property that is not `null` or
 * `undefined`.
 */
const projectionFields = (body) => {
  const projection = {}
  for (const propName in body) {
    if (body[propName] !== null && body[propName] !== undefined) {
      projection[propName] = 1
    }
  }
  return projection
}

// This is common function we are using for sending response
// function createResponse({ req, res, statusCode = 200, messageKey = null, replacementKey, data, others = {} }) {
//   if (statusCode === 200 && !messageKey) messageKey = 'success'
//   // Determine the actual status and jsonStatus based on statusCode
//   const actualJsonStatus = jsonStatus[statusCode]

//   // Prepare the message
//   let message = messagesLang[req.userLanguage][messageKey]
//   if (replacementKey) {
//     const replacement = messagesLang[req.userLanguage][replacementKey]
//     message = message.replace('##', replacement)
//   }

//   // Return the JSON response
//   return res.status(statusCode).jsonp({
//     status: actualJsonStatus,
//     message,
//     data,
//     ...others
//   })
// }

/**
 * The above code contains various utility functions for error handling, data manipulation, validation,
 * encryption, and retrieving IP address.
 * @param name - The `name` parameter is a string that represents the name or identifier of the error.
 * It is used for logging purposes to identify the specific error that occurred.
 * @param error - The `error` parameter is an object that represents an error. It can contain various
 * properties such as `code`, `response`, `responseCode`, etc.
 * @param req - The `req` parameter is an object that represents the HTTP request made by the client.
 * It contains information such as the request headers, request method, request URL, request body, and
 * other relevant details.
 * @param res - The `res` parameter in the code refers to the response object in a Node.js server. It
 * is used to send the response back to the client after processing a request. The `res` object
 * contains methods and properties that allow you to set the response status code, headers, and body.
 * @returns The code snippet does not have a specific return statement. It consists of several
 * functions and utility methods, but none of them have a return statement.
 */
// const catchError = (name, error, req, res) => {
//   handleCatchError(error, name)
//   return createResponse({ req, res, statusCode: status.InternalServerError, messageKey: messages.error })
// }

/**
 * The function `handleCatchError` logs error messages and data, with optional customization based on
 * the error type and environment.
 * @param error - The `error` parameter is the error object that is being handled. It can contain
 * information about the error, such as the error message, stack trace, and any additional properties
 * specific to the error type.
 * @param [name] - The `name` parameter is a string that represents the name or identifier of the
 * error. It is used to provide additional context when logging the error message.
 * @returns Nothing is being returned from the `handleCatchError` function. It is only logging messages
 * to the console.
 */
const handleCatchError = (error, name = '') => {
  const { data = undefined, status = undefined } = error.response ?? {}

  if (error?.code === 'EAUTH' && error?.responseCode === 535) return console.log('**********ERROR***********', 'Username and Password not accepted')
  if (!status) console.log(`********** ${name} ERROR ***********`, error)
  else console.log(`********** ${name} ERROR ***********`, { status, data, error: data.errors })
}

/**
 * The `pick` function takes an object and an array of keys, and returns a new object with only the
 * properties from the original object that match the keys in the array.
 * @param object - The `object` parameter is an object from which we want to pick specific keys.
 * @param keys - An array of strings representing the keys of the properties you want to pick from the
 * object.
 * @returns The function `pick` returns a new object that contains only the properties specified by the
 * `keys` array.
 */
const pick = (object, keys) => {
  return keys.reduce((obj, key) => {
    if (object && object.hasOwnProperty(key)) {
      obj[key] = object[key]
    }
    return obj
  }, {})
}

/**
 * The function checks if a given input contains only alphanumeric characters.
 * @param input - The input parameter is a string that you want to check if it contains only
 * alphanumeric characters.
 * @returns a boolean value. It returns true if the input string contains only alphanumeric characters
 * (letters and numbers), and false otherwise.
 */
const checkAlphanumeric = (input) => {
  const letters = /^[0-9a-zA-Z]+$/
  return !!(input.match(letters))
}

/**
 * The function `validatePassword` checks if a given password meets certain criteria.
 * @param pass - The `pass` parameter represents the password that needs to be validated.
 * @returns The function `validatePassword` returns a boolean value. It returns `true` if the `pass`
 * parameter matches the specified regular expression pattern, which represents a valid password. It
 * returns `false` otherwise.
 */
const validatePassword = (pass) => {
  const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,15}$/
  return !!(pass.match(regex))
}

/**
 * The function `validateUsername` checks if a given string is a valid username, which consists of 3 to
 * 15 alphanumeric characters or underscores.
 * @param sUsername - The parameter `sUsername` is a string representing a username that needs to be
 * validated.
 */
const validateUsername = (sUsername) => /^\w{3,15}$/.test(sUsername)

/**
 * The function `randomStr` generates a random string of a specified length and type.
 * @param len - The `len` parameter represents the length of the random string that you want to
 * generate.
 * @param type - The `type` parameter in the `randomStr` function is used to determine the type of
 * characters that should be included in the generated random string. There are three possible values
 * for the `type` parameter:
 * @returns a random string of characters based on the specified length and type.
 */
const randomStr = (len, type) => {
  let char = ''
  if (type === 'referral' || type === 'private') {
    char = '0123456789abcdefghijklmnopqrstuvwxyz'
  } else if (type === 'otp') {
    char = '0123456789'
  }
  let val = ''
  for (let i = len; i > 0; i--) {
    val += char[generateNumber(0, char.length)]
  }

  if (val.length === len) {
    return val
  } else {
    randomStr(len, type)
  }
}

/**
 * The function `defaultSearch` takes a string as input and escapes special characters in the string to
 * make it safe for use in a search query.
 * @param val - The `val` parameter is a string that represents the search value.
 * @returns The function `defaultSearch` returns the modified `val` string after replacing certain
 * characters with their escaped versions. If `val` is truthy, the modified string is returned.
 * Otherwise, an empty string is returned.
 */
const defaultSearch = (val) => {
  let search
  if (val) {
    search = val.replace(/\\/g, '\\\\')
      .replace(/\$/g, '\\$')
      .replace(/\*/g, '\\*')
      .replace(/\+/g, '\\+')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
      .replace(/\)/g, '\\)')
      .replace(/\(/g, '\\(')
      .replace(/'/g, '\\\'')
      .replace(/"/g, '\\"')
    return search
  } else {
    return ''
  }
}

/**
 * The function `getPaginationValues` takes an object as input and returns an object with pagination
 * values, sorting criteria, and search term.
 * @param obj - The `obj` parameter is an object that contains the following properties:
 * @returns The function `getPaginationValues` returns an object with the properties `start`, `limit`,
 * `sorting`, and `search`.
 */
const getPaginationValues = (obj) => {
  let { start = 0, limit = 10, sort = 'dCreatedAt', order, search } = obj

  start = parseInt(start)
  limit = parseInt(limit)

  const orderBy = order && order === 'asc' ? 1 : -1

  const sorting = { [sort]: orderBy }

  if (search) search = defaultSearch(search)

  return { start, limit, sorting, search }
}

/**
 * The function `getPaginationValues2` takes an object as input and returns an object with pagination
 * values, sorting criteria, and search parameters.
 * @param obj - The `obj` parameter is an object that contains the following properties:
 * @returns The function `getPaginationValues2` returns an object with the properties `start`, `limit`,
 * `sorting`, and `search`.
 */
const getPaginationValues2 = (obj) => {
  let { start = 0, limit = 10, sort = 'dCreatedAt', order, search } = obj
  const orderBy = order && order === 'asc' ? 1 : -1

  const sorting = { [sort]: orderBy }
  if (search) search = defaultSearch(search)
  return { start, limit, sorting, search }
}

/**
 * The function "encryption" takes a field as input, encrypts it using a public key, and returns the
 * encrypted value as a string.
 * @param field - The `field` parameter is the value that you want to encrypt using the `encryption`
 * function.
 * @returns The encrypted field as a string.
 */
// const encryption = function (field) {
//   const encrypted = crypt.encrypt(PUBLIC_KEY, field)
//   return encrypted.toString()
// }

/**
 * The function "validateEmail" checks if a given email address is valid using a regular expression.
 * @param email - The `email` parameter is a string that represents an email address.
 * @returns a boolean value. It returns true if the email passed as an argument matches the regular
 * expression pattern for a valid email address, and false otherwise.
 */
function validateEmail(email) {
  const sRegexEmail = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/
  return !!(email.match(sRegexEmail))
}
const getIp = function (req) {
  try {
    let ip = req.header('x-forwarded-for') ? req.header('x-forwarded-for').split(',') : []
    ip = ip[0] || req.socket.remoteAddress
    return ip
  } catch (error) {
    handleCatchError(error)
    return req.socket.remoteAddress
  }
}

/**
 * This function will validate mobile number that is 10 digit or not.
 * @param {*} 1234567890 Mobile Number
 * return true if matched result of mobile number otherwise return false.
 */
function validateMobile(mobile) {
  return !mobile.match(/^\+?[1-9][0-9]{8,12}$/) // !mobile.match(/^\d{10}$/)
}

function validateIndianMobile(mobile) {
  return !!mobile.match(/^\+?\d{10}$/)
  // return !!mobile.match(/^\+?[0-9]{10}$/)
}

/**
 * to validate pin code
 * @param  {number} pin
 * @return { boolean }
 */
function validatePIN(pin) {
  return /^\d{6}$/.test(pin)
}

/**
 * The function checks if a given file name and content type correspond to a valid image format.
 * @param sFileName - The sFileName parameter is a string that represents the name of the file,
 * including its extension. For example, "image.jpg" or "photo.png".
 * @param sContentType - The `sContentType` parameter represents the content type of the image file. It
 * is typically a string that specifies the media type of the image, such as "image/jpeg" or
 * "image/png".
 * @returns a boolean value. It returns true if the image format and content type are valid, and false
 * otherwise.
 */
// function checkValidImageType(sFileName, sContentType) {
//   const extension = sFileName.split('.').pop().toLowerCase()
//   const valid = imageFormat.find(format => format.extension === extension && format.type === sContentType)
//   return !!valid
// }

/**
 * The function `getBucketName` returns the appropriate bucket name based on the cloud storage
 * provider.
 * @returns The function `getBucketName` returns the value of the variable `sBucketName`.
 */
const getBucketName = () => {
  let sBucketName = S3_BUCKET_NAME

  if (CLOUD_STORAGE_PROVIDER === 'GC') {
    sBucketName = GCS_BUCKET_NAME
  } else if (CLOUD_STORAGE_PROVIDER === 'AZURE') {
    sBucketName = AZURE_STORAGE_CONTAINER_NAME
  }
  return sBucketName
}

// Change jwt field User Type during generate
const getUserType = (userType) => {
  try {
    userType === 'U' ? userType = '1' : userType = '2'
    return userType
  } catch (error) {
    handleCatchError(error)
  }
}

// this function is generate random number between min and max value
// min, max value should be safe Integer
function generateNumber(min, max) {
  return randomInt(min, max)
}

/**
 * The function checks if a mobile number has a country code.
 * @param mobile - The `mobile` parameter is a string representing a mobile phone number.
 * @returns a boolean value.
 */
function checkCountryCode(mobile) {
  return /^\+?1|\|1|\D/.test(mobile)
}

/**
 * The function "validateIndianNumber" checks if a given mobile number is a valid Indian number.
 * @param mobile - The mobile parameter is a string representing an Indian phone number.
 * @returns a boolean value indicating whether the given mobile number is a valid Indian number or not.
 */
function validateIndianNumber(mobile) {
  return /^[6-9]\d{9}$/.test(mobile)
}

/**
 * The function encrypts a given value using AES encryption with a specified key and returns the
 * encrypted cipher text.
 * @param value - The `value` parameter is the plaintext key that you want to encrypt.
 * @returns the cipher text, which is the encrypted version of the input value.
 */
// function encryptKey(value) {
//   if (value) {
//     try {
//       const message = CryptoJS.enc.Utf8.parse(value)
//       const encrypted = CryptoJS.AES.encrypt(message, encryptedKey, {
//         iv,
//         mode: CryptoJS.mode.CBC,
//         padding: CryptoJS.pad.Pkcs7
//       })
//       const cipherText = encrypted.toString()
//       return cipherText
//     } catch (error) {

//     }
//     return value
//   }
// }

/**
 * The function decrypts a given key using AES encryption and returns the decrypted message if
 * successful, otherwise it returns the original key.
 * @param key - The `key` parameter is the value that you want to decrypt. It is the encrypted value
 * that you want to convert back to its original form.
 * @returns The function will return the decrypted message if it is successfully decrypted, otherwise
 * it will return the original key.
 */
// function decryptValue(key) {
//   if (key) {
//     try {
//       const decrypted = CryptoJS.AES.decrypt(key, encryptedKey, { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 })
//       const decryptedMessage = decrypted?.toString(CryptoJS.enc.Utf8)
//       if (decryptedMessage.length) {
//         return decryptedMessage
//       }
//     } catch (error) {
//       console.error('Decryption failed:', error)
//     }
//     return key
//   }
// }

// function dateDiffInDays(startDate, EndDate) {
//   // Discard the time and time-zone information.
//   const dateFormat = 'YYYY-MM-DD'
//   const sD = moment(startDate).format(dateFormat)
//   const eD = moment(EndDate).format(dateFormat)
//   const differenceInDays = moment(sD).diff(eD, 'days')
//   return { differenceInDays, sD, eD }
// }

// convert id to mongoose id
function ObjectId(id) {
  return new mongoose.Types.ObjectId(id)
}

/**
 * The function `fieldsToDecrypt` takes an array of field names and an object of data, and decrypts the
 * values of the specified fields in the data object.
 * @param aField - `aField` is an array of field names that need to be decrypted.
 * @param data - The `data` parameter is an object that contains the fields to be decrypted.
 * @returns the updated `data` object with the specified fields decrypted.
 */
// function fieldsToDecrypt(aField, data) {
//   for (const field of aField) {
//     if (data[field]) data[field] = decryptValue(data[field])
//   }
//   return data
// }

/**
 * The function `fieldsToReset` takes an array of field names and an object, and sets the values of the
 * fields in the object to an empty string.
 * @param aField - An array of field names that need to be reset.
 * @param data - The `data` parameter is an object that contains various fields and their corresponding
 * values.
 * @returns the updated `data` object with the specified fields reset to an empty string.
 */
function fieldsToReset(aField, data) {
  for (const field of aField) {
    if (data[field]) data[field] = ''
  }
  return data
}

function createUtmObject(data) {
  if (Object.keys(data).length) {
    const oUtm = {
      sUtmSource: data?.sUtmSource?.toLowerCase() || '',
      sUtmMedium: data.sUtmMedium || '',
      sUtmCampaign: data.sUtmCampaign || '',
      sUtmContent: data.sUtmContent || '',
      sUtmTerm: data.sUtmTerm || ''
    }

    for (const key in oUtm) {
      if (!oUtm[key] || oUtm[key] === '' || oUtm[key] === null || oUtm[key] === undefined) {
        delete oUtm[key]
      }
    }
    return oUtm
  } else {
    return {}
  }
}

module.exports = {
  removenull,
  //   catchError,
  handleCatchError,
  pick,
  checkAlphanumeric,
  randomStr,
  getPaginationValues,
  projectionFields,
  //   encryption,
  validateEmail,
  getPaginationValues2,
  getIp,
  validateMobile,
  validatePassword,
  validatePIN,
  //   checkValidImageType,
  validateUsername,
  getBucketName,
  getUserType,
  generateNumber,
  replaceSensitiveInfo,
  checkCountryCode,
  validateIndianNumber,
  //   encryptKey,
  //   decryptValue,
  //   dateDiffInDays,
  validateIndianMobile,
  //   createResponse,
  ObjectId,
  //   fieldsToDecrypt,
  fieldsToReset,
  createUtmObject,
  defaultSearch,
  encryptEnv,
  decryptEnv
}
