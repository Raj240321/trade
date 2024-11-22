/* eslint-disable quote-props */
const symbolModel = require('../../models/symbol.model')
const axios = require('axios')
const { start } = require('../../queue')
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
      const { role } = req.admin // Get role from admin context
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
        if (active !== undefined) query.active = active == true
      } else {
        query.active = true // Regular users can only see active symbols
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
      const sort = { [sortBy]: sortOrder, expiry: 1 }

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
        'cookie': 'defaultLang=en; _ga=GA1.1.371866825.1731588619; nseQuoteSymbols=[{"symbol":"ADANIPORTS","identifier":null,"type":"equity"}]; nsit=7PXHTe19olQtnAGWLrTNFTL4; AKA_A2=A; nseappid=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJhcGkubnNlIiwiYXVkIjoiYXBpLm5zZSIsImlhdCI6MTczMTY0NTkwMywiZXhwIjoxNzMxNjUzMTAzfQ.D7Qcj3nYrUG-NbtsQqEbRrvpL2KIc2flfMwGo3_V_Kk; bm_mi=65572160B59DB93D8CE11FCE3ABA94B9~YAAQH/7UF9GWIyaTAQAARZkjLhm2mWwsCbVx1tW85lK7OSbzjb8eckqYfZ9TmE9bG5yBxQiUnDhp9oAOMp5BlZEifaxPYMNZGufJJIvRUoQJPWhpFRlAD/wspEvjIXGcIrHctgagslAT//YeiatE+Hxww3grMOQSCU44mj3B53xFfkMnyLsZcIn4FBSTa+O4lhkAAc+6ikZ9Fn8PLHSlnIYB40vOXHfJVxMmJqPHpVJIhybUec2dIagZXTa49Hcs1MSmntqGks8fwS1pKSmiK08YZhyJ4R2H97K74JhiaVscZNCchSBmEAqa4PnEpQ4sfE0fZKrwQcKwoB2xLBzLNIzz7w==~1; bm_sz=B11B2069F02C89A7D73E8F64170E4399~YAAQH/7UF9OWIyaTAQAARZkjLhluChrZprcGH+6bA0tM12LmncMsdhsqQ/zXHhIWGXGBGjiTbUb11yJHayrcpjk3QVa1y3By69K3M32jwbSvqEvzPRoTq/TiEO1MshJyB2/uvJlf4PJfNGVCKymVjMjChR0S5i199zAAZkS9sIva8lyT6Ct+FcBvt4vcUDix8XUmHxiNwOXmfvJD/tIsg9zea30wz+0Cmv65uswYItA+HayuxqXM/XyEPDWnhxq5/43EAVPZXzRbTLtOc5CjsqcP2sv2K6r7jLusnnvrU3wDBb2wJIOwUpO/2lTBhRtwxE6JJcbOkjE78gHXbJuOatOqoRKWDGX4k/VGKGjYfD/8hnaPHasZb1d992MM25oVAlMWvPbqWfZvmj1IQIa5Z2deiplvhzOidg==~3420996~4473905; _abck=F0A071714C929E52AC5F29FD2AD38182~0~YAAQH/7UFwaXIyaTAQAArpwjLgyTgNnCWUt2xL1JlLps1RIreCwK5B4/aB3Sj/1VaCZ8vYZX/333aBw0dTNRp9fkKu3zCK4G0+rhId8nw3oBFQvffQIUQONW/YGkYru+c4HYSJqARLTFN5LuO9hXPf0XSJKzXdVoDS8lzVWUQeOTTnqT2Lz0YPvNjSBST7XXSiuh/DPHpYlMCO8ypBIx4W3LTyIgxzE43PVbp2LeRVtFRH8iLszO7bz5CXy2/wzmFdJEkTrofu+zY8yo3q8x3b/LtIOrOEJlFPKbeR+GflzmVGjdlVG5pbFTLMR2Kz6r911eT1B64kA9i/BoJIgatYL/ClGZPy30tfECGM8J3QyjMBzo9P3Hf3V3QRMeoUlp8iNVgSe5HYyPA+PyC62z9f2GKnkTXTjbFZHfcWuS+vLy2Wwa1LiaT2y0ScZW7Rp/UJPviv+52FIJgkKJbFA/DEire+4r+Q+9/w5fVgIn4ABDmA==~-1~-1~-1; _ga_87M7PJ3R97=GS1.1.1731645728.2.1.1731645906.59.0.0; _ga_WM2NSQKJEK=GS1.1.1731645728.5.1.1731645906.0.0.0; ak_bmsc=4438C646CD3AE3A5D3EE3169648308B6~000000000000000000000000000000~YAAQH/7UF06XIyaTAQAAvJ8jLhm59UbKFHRq0eQnnumdiBG1pWLRarDy0ZlgoriOZ9T+8hmLZFt8/rcZdijGZkTWIy7/ZxVmBfsmlifD6Pbniu67of4rXc42tLG40XL9EKW5oMzAJ9CqieNSdKj99FYWD7f31XEzQwIx1H2CfZF+l8EfS+yqIsLI2OqLNOgEnJK8tMMgfi1E7G3NPHTBhggt3fFeNT5/aw4i1MmkJ44jasO/GYvQapz6Wdo0ONnk2+03qOh+u6UuNSctHkWqgvf62HpYs9vblLfVVjNul4lg01ZBabuIOCDVt6ug64hQDbbmjV9xKdYhHq97eEQqVZfXBogM5VgrtY3i7lplER9mDj+yZ++nQiaBSQyyFI9R3dmwz8pnQ8SdjN0ND0JXjfKJSwILZ2PycD+vxQOeun1SR1+hBaff6TGTn6SCQgpPFmOsWKluh/87I0uaNclItGXnfrtDcaCD7MDVbhRFpDizPUotkvMfbtehhqhZ/2ThLK5g4+J4; RT="z=1&dm=nseindia.com&si=6b30129a-d463-4538-82de-aa80cf6edf0a&ss=m3i95mk3&sl=2&se=8c&tt=3wl&bcn=%2F%2F684d0d4c.akstat.io%2F&ld=3v4j"; bm_sv=C81A923EB3A889913C3325C17E769CC0~YAAQFf7UF+34fCWTAQAAttkjLhmJ+fA2VtlRWW1+ssB2EnNAe0NbzPRHjL2B0lj9IQiXDvqZYa+s7u3PtvwMAspQ/6sc/yHO7a+LH+8Vhm1CfvZRjzJKkKmUVMXnTtIALcnGDtGvl/K2W8NslI50fuc5ibRP28OX9B6dcp/Lmj0LjP1t4o0L9CWjlCod3DHeDlbUEdBxNVGJRB6XiytfKtZJrlTOBY5/cqVIarSEfUpWIE0g1DjTziMOqZgObevwdTgw~1',
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

start()
