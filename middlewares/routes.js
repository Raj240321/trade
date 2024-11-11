module.exports = (app) => {
  app.get('/health-check', (req, res) => {
    const sDate = new Date().toJSON()
    return res.status(200).jsonp({ status: 200, message: `${sDate} => This is the right time to smile` })
  })
  app.use('/api/trade', [
    require('../service/admin/routes'),
    require('../service/settings/routes'),
    require('../service/script/routes')
  ])
  app.get('*', (req, res) => {
    return res.status(404).jsonp({ status: 404, message: 'Its time to take a deep breath ...' })
  })
}
