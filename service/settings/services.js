const SettingModel = require('../../models/settings.model')
const SymbolModel = require('../../models/symbol.model')
const { pick, removenull, encryptEnv } = require('../../helper/utilites.service')
const mongoose = require('mongoose')
const ObjectId = mongoose.Types.ObjectId
const { createToken } = require('../../queue')
const { redisClient } = require('../../helper/redis')
const config = require('../../config/config')
class Setting {
  findSetting(key) {
    return SettingModel.findOne({ key, status: 'y' }).lean()
  }

  // To add Setting
  async add(req, res) {
    try {
      req.body.key = req.body.key.toUpperCase()
      const { key } = req.body
      req.body = pick(req.body, ['title', 'key', 'max', 'min', 'status', 'description', 'value'])
      const exist = await SettingModel.findOne({ key }).lean()
      if (exist) {
        return res.status(400).jsonp({ status: 400, message: 'settings already exists.' })
      }
      await SettingModel.create({ ...req.body })
      return res.status(200).jsonp({ status: 200, message: 'settings added successfully.' })
    } catch (error) {
      console.log('settings.add', error)
      return res.status(500).jsonp({ status: 500, message: 'something went wrong.' })
    }
  }

  // To update Setting
  async update(req, res) {
    try {
      req.body.key = req.body.key.toUpperCase()
      const { key } = req.body
      req.body = pick(req.body, ['title', 'key', 'max', 'min', 'status', 'description', 'value'])
      removenull(req.body)
      const setting = await SettingModel.findOne({ key, _id: { $ne: new ObjectId(req.params.id) } }).lean()
      if (setting) {
        return res.status(400).jsonp({ status: 400, message: 'key already exists.' })
      }
      const data = await SettingModel.findByIdAndUpdate(req.params.id, { ...req.body }, { new: true, runValidators: true }).lean()
      if (!data) {
        return res.status(400).jsonp({ status: 400, message: 'setting not exists.' })
      }
      return res.status(200).jsonp({ status: 200, message: 'setting update successfully.' })
    } catch (error) {
      console.log('settings.update', error)
      return res.status(500).jsonp({ status: 500, message: 'something went wrong.' })
    }
  }

  // To get List of Setting with pagination, sorting and searching
  async list(req, res) {
    try {
      const { page = 1, limit = 10, search } = req.query
      const query = search ? { title: { $regex: new RegExp('^.*' + search + '.*', 'i') } } : { }
      const results = await SettingModel.find(query, {
        title: 1,
        key: 1,
        max: 1,
        min: 1,
        value: 1,
        status: 1,
        description: 1,
        createdAt: 1
      }).sort({ createdAt: -1 }).skip((Number(page) - 1) * limit).limit(Number(limit)).lean()

      const total = await SettingModel.countDocuments({ ...query })
      const data = { total, results }
      return res.status(200).jsonp({ status: 200, message: 'setting fetch successfully.', data })
    } catch (error) {
      console.log('settings.list', error)
      return res.status(500).jsonp({ status: 500, message: 'something went wrong.' })
    }
  }

  // To get details of single Setting by _id
  async get(req, res) {
    try {
      const data = await SettingModel.findById(req.params.id).lean()
      if (!data) {
        return res.status(400).jsonp({ status: 400, message: 'setting not exists.' })
      }
      return res.status(200).jsonp({ status: 200, message: 'setting fetch successfully.', data })
    } catch (error) {
      console.log('settings.get', error)
      return res.status(500).jsonp({ status: 500, message: 'something went wrong.' })
    }
  }

  async deleteSetting(req, res) {
    try {
      const { id } = req.params
      const deletedSetting = await SettingModel.findOneAndDelete({ _id: new ObjectId(id) })
      if (!deletedSetting) {
        return res.status(400).jsonp({ status: 400, message: 'setting not exists.' })
      }
      return res.status(200).jsonp({ status: 200, message: 'setting delete successfully.' })
    } catch (err) {
      console.log('settings.delete', err)
      return res.status(500).jsonp({ status: 500, message: 'something went wrong.' })
    }
  }

  // To get details of single Setting by key for admin side validation
  async getSettingByKey(req, res) {
    try {
      const data = await SettingModel.findOne({ key: req.query.key.toUpperCase() }).lean()
      if (!data) {
        return res.status(400).jsonp({ status: 400, message: 'setting not exists.' })
      }
      return res.status(200).jsonp({ status: 200, message: 'setting fetch successfully.', data })
    } catch (error) {
      console.log('settings.getSettingByKey', error)
      return res.status(500).jsonp({ status: 500, message: 'something went wrong.' })
    }
  }

  async sendThirdPartyToken(req, res) {
    try {
      let sessionToken = await redisClient.get('sessionToken')
      if (!sessionToken) {
        sessionToken = await createToken()
        if (!sessionToken) {
          return res.status(500).jsonp({ status: 400, message: 'Third Party service not working.' })
        }
      }
      const loginId = encryptEnv(config.LOGIN_ID)
      const product = encryptEnv(config.PRODUCT)
      return res.status(200).jsonp({ status: 200, message: 'setting fetch successfully.', data: { sessionToken: encryptEnv(sessionToken), loginId, product } })
    } catch (err) {
      console.log('settings.sendThirdPartyToken', err)
      return res.status(500).jsonp({ status: 500, message: 'something went wrong.' })
    }
  }
}

module.exports = new Setting()

async function settingSeeder() {
  try {
    const isSettingExists = await SettingModel.countDocuments()
    if (!isSettingExists) {
      const data = [{
        title: 'Allowed Market',
        key: 'MARKET',
        max: 0,
        min: 0,
        description: 'Allowed market value',
        status: 'y',
        value: [
          'NSE',
          'MCX'
        ]
      },
      {
        title: 'NSE SYMBOL NAME LIST',
        key: 'NSE_SYMBOL',
        max: 0,
        min: 0,
        description: 'NSE symbols name list',
        status: 'y',
        value: [
          'AARTIIND',
          'ABB',
          'ABBOTINDIA',
          'ABCAPITAL',
          'ABFRL',
          'ACC',
          'ADANIENT',
          'ADANIPORTS',
          'ALKEM',
          'AMBUJACEM',
          'APOLLOHOSP',
          'APOLLOTYRE',
          'ASHOKLEY',
          'ASIANPAINT',
          'ASTRAL',
          'ATUL',
          'AUBANK',
          'AUROPHARMA',
          'AXISBANK',
          'BAJAJ-AUTO',
          'BAJAJFINSV',
          'BAJFINANCE',
          'BALKRISIND',
          'BANDHANBNK',
          'BANKBARODA',
          'BATAINDIA',
          'BEL',
          'BERGEPAINT',
          'BHARATFORG',
          'BHARTIARTL',
          'BHEL',
          'BIOCON',
          'BOSCHLTD',
          'BPCL',
          'BRITANNIA',
          'BSOFT',
          'CANBK',
          'CANFINHOME',
          'CHAMBLFERT',
          'CHOLAFIN',
          'CIPLA',
          'COALINDIA',
          'COFORGE',
          'COLPAL',
          'CONCOR',
          'COROMANDEL',
          'CROMPTON',
          'CUB',
          'CUMMINSIND',
          'DABUR',
          'DALBHARAT',
          'DEEPAKNTR',
          'DIVISLAB',
          'DIXON',
          'DLF',
          'DRREDDY',
          'EICHERMOT',
          'ESCORTS',
          'EXIDEIND',
          'FEDERALBNK',
          'GAIL',
          'GLENMARK',
          'GMRINFRA',
          'GNFC',
          'GODREJCP',
          'GODREJPROP',
          'GRANULES',
          'GRASIM',
          'GUJGASLTD',
          'HAL',
          'HAVELLS',
          'HCLTECH',
          'HDFCAMC',
          'HDFCBANK',
          'HDFCLIFE',
          'HEROMOTOCO',
          'HINDALCO',
          'HINDCOPPER',
          'HINDPETRO',
          'HINDUNILVR',
          'ICICIBANK',
          'ICICIGI',
          'ICICIPRULI',
          'IDEA',
          'IDFC',
          'IDFCFIRSTB',
          'IEX',
          'IGL',
          'INDHOTEL',
          'INDIAMART',
          'INDIGO',
          'INDUSINDBK',
          'INDUSTOWER',
          'INFY',
          'IOC',
          'IPCALAB',
          'IRCTC',
          'ITC',
          'JINDALSTEL',
          'JKCEMENT',
          'JSWSTEEL',
          'JUBLFOOD',
          'KOTAKBANK',
          'LALPATHLAB',
          'LAURUSLABS',
          'LICHSGFIN',
          'LT',
          'LTF',
          'LTIM',
          'LTTS',
          'LUPIN',
          'M&M',
          'M&MFIN',
          'MANAPPURAM',
          'MARICO',
          'MARUTI',
          'MCX',
          'METROPOLIS',
          'MFSL',
          'MGL',
          'MOTHERSON',
          'MPHASIS',
          'MRF',
          'MUTHOOTFIN',
          'NATIONALUM',
          'NAUKRI',
          'NAVINFLUOR',
          'NESTLEIND',
          'NMDC',
          'NTPC',
          'OBEROIRLTY',
          'OFSS',
          'ONGC',
          'PAGEIND',
          'PEL',
          'PERSISTENT',
          'PETRONET',
          'PFC',
          'PIDILITIND',
          'PIIND',
          'PNB',
          'POLYCAB',
          'POWERGRID',
          'PVRINOX',
          'RAMCOCEM',
          'RBLBANK',
          'RECLTD',
          'RELIANCE',
          'SAIL',
          'SBICARD',
          'SBILIFE',
          'SBIN',
          'SHREECEM',
          'SHRIRAMFIN',
          'SIEMENS',
          'SRF',
          'SUNPHARMA',
          'SUNTV',
          'SYNGENE',
          'TATACHEM',
          'TATACOMM',
          'TATACONSUM',
          'TATAMOTORS',
          'TATAPOWER',
          'TATASTEEL',
          'TCS',
          'TECHM',
          'TITAN',
          'TORNTPHARM',
          'TRENT',
          'TVSMOTOR',
          'UBL',
          'ULTRACEMCO',
          'UNITDSPR',
          'UPL',
          'VEDL',
          'VOLTAS',
          'WIPRO',
          'ZYDUSLIFE',
          'NIFTY',
          'BANKNIFTY'
        ]
      },
      {
        title: 'HOLIDAY LIST',
        key: 'HOLIDAY_LIST',
        max: 0,
        min: 0,
        description: 'Market Holiday list',
        status: 'y',
        value: [
          '2024-12-25'
        ]
      },
      {
        title: 'Extra Session List',
        key: 'EXTRA_SESSION',
        max: 0,
        min: 0,
        description: 'Extra session list',
        status: 'y',
        value: [
          '2025-02-02'
        ]
      }]
      await SettingModel.insertMany(data)
    }
    const isNiftyExists = await SymbolModel.countDocuments({ key: { $in: ['NSE_INDICES_NIFTY', 'NSE_INDICES_BANKNIFTY'] } })
    if (!isNiftyExists) {
      const symbolData = [{
        key: 'NSE_INDICES_NIFTY',
        name: 'NIFTY 50',
        symbol: 'NIFTY',
        exchange: 'NSE',
        type: 'INDICES',
        expiry: new Date('2030-03-25T00:00:00.000Z')
      }, {
        key: 'NSE_INDICES_BANKNIFTY',
        name: 'BANK NIFTY',
        symbol: 'BANKNIFTY',
        exchange: 'NSE',
        type: 'INDICES',
        expiry: new Date('2030-03-25T00:00:00.000Z')
      }]
      await SymbolModel.insertMany(symbolData)
    }
    console.log('Setting seeder executed successfully.')
  } catch (error) {
    console.log(error)
  }
}
settingSeeder()
