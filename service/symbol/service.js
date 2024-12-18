/* eslint-disable quote-props */
const symbolModel = require('../../models/symbol.model')
const axios = require('axios')
const BlockModel = require('../../models/block.model')
const { ObjectId } = require('../../helper/utilites.service')
class Symbol {
  async createSymbol(req, res) {
    try {
      let { symbols, exchange, day = 4 } = req.body
      exchange = exchange.toUpperCase()
      const type = exchange === 'NSE' ? 'FUTSTK' : 'FUTCOM'
      const allExpiry = exchange === 'NSE' ? [] : getLastDay(day)
      const allData = []
      // Loop through each symbol
      for (let symbol of symbols) {
        symbol = symbol.toUpperCase()

        let data = []
        if (exchange === 'NSE') {
          data = await fetchDataFromNSE(symbol)
          console.log(data)
        }

        if (data.length > 0) {
          // If data exists, format and push to allData array
          for (const scriptData of data) {
            const stringExpiry = formatNSEExpiryDate(scriptData.expiryDate)
            const key = `${exchange}_${type}_${symbol}_${stringExpiry}`
            const name = `${symbol} ${stringExpiry}`
            const obj = {
              key,
              name,
              symbol,
              exchange: 'NSE',
              type: 'FUTSTK',
              ...scriptData,
              expiry: new Date(scriptData.expiryDate)
            }
            const existingSymbol = await symbolModel.findOne({ key }).lean()

            if (existingSymbol) {
              continue
            }
            allData.push(obj)
          }
        } else {
          // If no data for NSE, process expiry dates
          const expiryDates = exchange === 'NSE' ? getLastDay(day) : allExpiry

          for (const eachExpiry of expiryDates) {
            const formattedExpiry = convertToDateFormat(eachExpiry)
            // Generate key and name, then push to allData array
            const stringExpiry = formatExpiryDate(formattedExpiry)
            const key = `${exchange}_${type}_${symbol}_${stringExpiry}`
            const name = `${symbol} ${stringExpiry}`
            const existingSymbol = await symbolModel.findOne({ key }).lean()
            if (existingSymbol) {
              continue
            }
            allData.push({ type, symbol, exchange, expiry: eachExpiry, key, name })
          }
        }
      }

      // Insert all new symbols at once, if any
      if (allData.length > 0) {
        await symbolModel.insertMany(allData)
      }

      return res.status(200).json({ status: 200, message: 'Symbol added successfully.' })
    } catch (error) {
      console.error('symbol.create', error)
      return res.status(500).json({ status: 500, message: 'Something went wrong.' })
    }
  }

  async removeSymbol(req, res) {
    try {
      const { symbols } = req.body
      await symbolModel.deleteMany({ symbol: { $in: symbols } })
      return res.status(200).json({ status: 200, message: 'Symbol removed successfully.' })
    } catch (error) {
      console.error('symbol.remove', error)
      return res.status(500).json({ status: 500, message: 'Something went wrong.' })
    }
  }

  async listSymbol(req, res) {
    try {
      const { role, id } = req.admin // Get role from admin context
      const {
        page = 1, // Optional: Page number for pagination
        limit = 10, // Optional: Number of items per page
        search = '', // Optional: Search string for symbol, name, or key
        exchange, // Optional: NSE or MCX
        type, // Optional: FUTCOM or FUTSTK
        active, // Optional: Filter by active status
        symbol,
        expiry, // Optional: Start date for expiry filter
        sortBy = 'symbol', // Optional: Sort field
        order = 1 // Optional: Sort order (1 for ascending, -1 for descending)
      } = req.query

      // Convert pagination and order values to integers
      const pageNumber = parseInt(page, 10)
      const pageSize = parseInt(limit, 10)
      const sortOrder = parseInt(order, 10)

      // Initialize query object
      const query = {}

      // Add filters to the query
      if (search) {
        query.$or = [
          { name: { $regex: new RegExp(search, 'i') } },
          { symbol: { $regex: new RegExp(search, 'i') } },
          { key: { $regex: new RegExp(search, 'i') } }
        ]
      }
      if (exchange) query.exchange = exchange.toUpperCase()
      if (type) query.type = type.toUpperCase()
      if (expiry) {
        query.expiry = expiry
      }
      if (symbol) {
        query.symbol = symbol.toUpperCase()
      }
      if (role === 'superMaster') {
        // eslint-disable-next-line eqeqeq
        if (active !== undefined) query.active = active
      } else {
        const blockQuery = {
          $or: [{ masterId: id }, { blockOn: id }, { brokersId: id }, { usersId: id }]
        }
        const blockSymbolId = await BlockModel.find(blockQuery, { scriptId: 1 })
        const allRemoveSymbol = blockSymbolId.map((item) => ObjectId(item.scriptId))
        query.active = true // Regular users can only see active symbols
        if (allRemoveSymbol.length > 0) {
          query._id = { $nin: allRemoveSymbol }
        }
      }

      // Projection for non-superMaster roles
      const projection = {}
      if (role !== 'superMaster') {
        projection.active = 0
        projection.createdAt = 0
        projection.updatedAt = 0
        projection.__v = 0
      }

      // Sorting
      const sort = { expiry: 1, [sortBy]: sortOrder }
      // Fetch filtered and paginated results
      const results = await symbolModel
        .find(query, projection)
        .sort(sort)
        .skip((pageNumber - 1) * pageSize)
        .limit(pageSize)
        .lean()

      // Get the total count for pagination
      const total = await symbolModel.countDocuments(query)

      // Response
      const data = {
        total,
        results
      }
      return res.status(200).json({
        status: 200,
        message: 'Symbols fetched successfully.',
        data
      })
    } catch (error) {
      console.error('symbol.list', error)
      return res.status(500).json({
        status: 500,
        message: 'Something went wrong.'
      })
    }
  }

  async getSymbol(req, res) {
    try {
      const { role } = req.admin
      const projection = {}
      if (role !== 'superMaster') {
        projection.active = 0
        projection.createdAt = 0
        projection.updatedAt = 0
        projection.key = 0
        projection.__v = 0
      }
      const data = await symbolModel.findById(req.params.id, projection).lean()
      if (!data) {
        return res.status(400).jsonp({ status: 400, message: 'symbol does not exist.' })
      }
      return res.status(200).jsonp({ status: 200, message: 'symbol fetch successfully.', data })
    } catch (error) {
      console.error('symbol.get', error)
      return res.status(500).jsonp({ status: 500, message: 'something went wrong.' })
    }
  }
}

module.exports = new Symbol()

function formatExpiryDate(expiry) {
  const [year, month, day] = expiry.split('/')
  const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
  return `${day}${monthNames[parseInt(month, 10) - 1]}${year}`
}

function formatNSEExpiryDate(expiry) {
  const [day, month, year] = expiry.split('-')
  const monthNames = {
    jan: 'JAN',
    feb: 'FEB',
    mar: 'MAR',
    apr: 'APR',
    may: 'MAY',
    jun: 'JUN',
    jul: 'JUL',
    aug: 'AUG',
    sep: 'SEP',
    oct: 'OCT',
    nov: 'NOV',
    dec: 'DEC'
  }
  const formattedMonth = monthNames[month.toLowerCase()]
  return `${day}${formattedMonth}${year}`
}

function getLastDay(day) {
  const today = new Date()
  const lastThursdays = []

  const findLastThursday = (year, month) => {
    const lastDay = new Date(year, month + 1, 0)
    while (lastDay.getDay() !== day) {
      lastDay.setDate(lastDay.getDate() - 1)
    }
    return lastDay
  }

  const currentMonthLastThursday = findLastThursday(today.getFullYear(), today.getMonth())
  if (today <= currentMonthLastThursday) {
    lastThursdays.push(currentMonthLastThursday)
  }

  for (let i = 1; i <= 2; i++) {
    const futureMonthLastThursday = findLastThursday(today.getFullYear(), today.getMonth() + i)
    lastThursdays.push(futureMonthLastThursday)
  }
  return lastThursdays
}

const convertToDateFormat = (date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}/${month}/${day}`
}

async function fetchDataFromNSE(symbol) {
  try {
    const config = {
      method: 'get',
      maxBodyLength: Infinity,
      url: `https://www.nseindia.com/api/quote-derivative?symbol=${symbol}`,
      headers: {
        'accept': '*/*',
        'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
        'cache-control': 'no-cache',
        'pragma': 'no-cache',
        'priority': 'u=1, i',
        'sec-ch-ua': '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'sec-gpc': '1',
        'cookie': 'defaultLang=en; _ga=GA1.1.371866825.1731588619; nsit=AncDLelGwHoOEOeD3UrjTxNi; AKA_A2=A; ak_bmsc=276BFFBCAE1B39EF24ED95F04BD60370~000000000000000000000000000000~YAAQNK3OF8kNny+TAQAA15rkixn2oEJ42KAAOv3y8UScqZYMc8d16dMmeGwftKQofQeDeELXp3I3xu1je7bTtKsw5h6bvoP1pXxhdBwpQQxiqCzYMZP2QXSlXwL/7nNJ3kDLikfVT3AHnqh5b7UjmVFPw+BEj5l0WVIhyD2tVT1esVj5Thv8DgrWfNE1KaOP7Po9ygJihGphNA8vcE94rrCAuhV5OXcbUw0JwL0Bp0yGd6K1Ybek4i9uYha7V+0RNSrpcNOGko4ErGiQ4ASLezk+BrhobfsHesiXzINpWjWBcOV4HMsthYdLoigA6lUp07t7aR89xN+LsE9pCg/RHbsuMcGmDOPSGkuf/WlKkbYKHCt0EUJr1h/BsIWpWAjBw11jaxIyEzmIWbmXDD3cFkKLzYE5I0WNiTkuZyqYXXiGy87oLgyX4+t64n0V9XlI+Cjxq8CrIdEiKZNirNye; nseQuoteSymbols=[{"symbol":"ADANIPORTS","identifier":null,"type":"equity"}]; nseappid=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJhcGkubnNlIiwiYXVkIjoiYXBpLm5zZSIsImlhdCI6MTczMzIxODg4MCwiZXhwIjoxNzMzMjI2MDgwfQ.AqLW1CmYYykrXv6W2FssGpEiGCSEhz_CWSLPUGv6P0c; bm_sz=72352BEE25A49D330C004AEA07F123A2~YAAQNK3OF1Iiny+TAQAA9UvlixkhH6+tthF/tT7+wkpDdnGdbyEzEFU+0+DJy0Ct/WWDSGD1MfVxgqCwVv2RBCi1SuiajQ8rZJotvKh5fFzW3JngOY1k8OY6Ka8OOaBzCjo59wtWY6FExI5MQS1LNza3KTlwm0zz4VbqDDuLCEikK66iPXamgCsiMilt1LtRB6VNA4efYPrjhDvJnqR+oYikF5jkHA4OCG9RaPzj/RpQhrhfT5FDDbvJ1ZP0up0xfeyvp1rDsLIbZOv7cbQPePEn9AKx8H+cRZYBAPY6PIt/z3BxymsuRevNDcpMr015l5gT+Vcr6W+ZaaSrbdQojRRRlG7td1xd3tiCV5/NQkieZBG7YIKju3pkVxL99Wj7t6dG5ZRGYuCm1nMOrDiGd6HDOX/loP5XNJNL3QRYT5JH~3425589~4342328; RT="z=1&dm=nseindia.com&si=f2b92769-f4d3-4374-84c7-c298a741e6bc&ss=m489qqnc&sl=3&se=8c&tt=4mj&bcn=%2F%2F684d0d4c.akstat.io%2F"; _abck=F0A071714C929E52AC5F29FD2AD38182~0~YAAQNK3OF40iny+TAQAApU3liwyaUX64WQ8JdSQ1vdtgVwJb9U2ZsFhEF6vhOq+GoF6gtZCr4dJDYf7WwDNjjQIdJcoONrc4NxmgQBrndLlr1aIqvEXoNrag/zUW6gGvVAeuLpFAuKjvDL3b11HtX4bJX/T9GAonCxEcoTMZpy2DoGl+808OWh5mvyfLUFb9uhYTfhHQjuv0GUbaRE6VasG5ho6SwOXXVPnWTvIN6Qol1QuiFIMSaNC2WCSLZA7hgEAJ3gS7L5vpuCWGOzf/Gn8uMsfGWTd1gPf8E4Tn+280jTqnXOyrFP0zNquMto0kWJwIvuzriXBRqYnKnkuX4rBF8GhP5JEinzZ+RZ4cUDKnbYTzg4Oz8tIJ4x3k0JvQP1iHONG1wKshyRmlF/XwlPUa48stL4MPf05r3Jv0G/oalcLXmghUBrCM05Gfl3UwBhIFaDVWl2b8RsiZzSqD8QIQ3upYsuwWffjSjD/EeSSbfA==~-1~-1~-1; _ga_87M7PJ3R97=GS1.1.1733218834.3.1.1733218881.13.0.0; _ga_WM2NSQKJEK=GS1.1.1733218834.6.1.1733218881.0.0.0; bm_sv=DAFC7434F34BE74AD4BEAE9DEE690D97~YAAQNK3OF8ciny+TAQAAAVLlixkhAExNp5YVQdTztlCMrci9iVtVzKaiNVBfnna8M3GkPzebfomj/cZ9vzIck4VcmAn07eX8UI1tlNj2c3m/yf5AYATnyXj1/gKammFfZG7NnvMQXXCbjijWWiFW4hlHAve9Txlk45yAs7Ss7CrNwwWBWuIfoVHfNyWyH2IfMVJ5VSlQYC3+pl9EyLIRMxCVfhWTk1WurFM27muFo7aaHgnB1qF0hxtQzOJetgxiV/r4~1',
        'Referer': 'https://www.nseindia.com/get-quotes/derivatives?symbol=ADANIPORTS',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
      }
    }

    const response = await axios.request(config)
    if (response.data.stocks.length > 0) {
      const scripts = []
      for (const stock of response.data.stocks) {
        const { metadata, marketDeptOrderBook } = stock
        if (metadata.instrumentType === 'Stock Futures') {
          scripts.push({
            expiryDate: metadata.expiryDate,
            identifier: metadata.identifier,
            Open: metadata.openPrice,
            High: metadata.highPrice,
            Low: metadata.lowPrice,
            closePrice: metadata.closePrice,
            PrevClose: metadata.prevClose,
            lastPrice: metadata.lastPrice,
            change: metadata.change,
            pChange: metadata.pChange,
            BSQ: marketDeptOrderBook.tradeInfo.marketLot,
            BBP: marketDeptOrderBook.carryOfCost.price.bestBuy,
            BSP: marketDeptOrderBook.carryOfCost.price.bestSell,
            settlementPrice: marketDeptOrderBook.otherInfo.settlementPrice
          })
        }
      }
      return scripts
    } else {
      return []
    }
  } catch (error) {
    console.log('error', error)
    return []
  }
}
