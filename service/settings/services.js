const SettingModel = require('../../models/settings.model')
const { pick, removenull } = require('../../helper/utilites.service')
const mongoose = require('mongoose')
const ObjectId = mongoose.Types.ObjectId
const { createToken } = require('../../queue')
const { redisClient } = require('../../helper/redis')
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
      return res.status(200).jsonp({ status: 200, message: 'setting fetch successfully.', data: { sessionToken } })
    } catch (err) {
      console.log('settings.sendThirdPartyToken', err)
      return res.status(500).jsonp({ status: 500, message: 'something went wrong.' })
    }
  }
}

module.exports = new Setting()
