const config = require('../config/config.js')
const axios = require('axios')
const { smsProvider } = require('../enum.js')

const sendOTPFromProvider = async (sProvider, oUser) => {
  try {
    if (!smsProvider.includes(sProvider)) throw new Error(`Provider ${sProvider} does not exist`)
    let data
    if (sProvider === 'MSG91') data = await msg91SendOrVerifyOTP('send', oUser)

    if (!data || !data.isSuccess) return { isSuccess: false }
    return data
  } catch (error) {
    console.log('sendOTPFromProvider giving error', error)
  }
}

async function msg91SendOrVerifyOTP(sAction = '', oUser) {
  try {
    const { sPhone, sOTP } = oUser
    if (!sPhone || !sOTP || !sAction) throw new Error('Invalid details')

    if (sAction === 'send') {
      try {
        const response = await axios.get('https://api.msg91.com/api/v5/otp', {
          params:
                    {
                      template_id: config.MSG91_TEMPLATE_ID,
                      mobile: `91${sPhone}`,
                      authkey: config.MSG91_AUTH_KEY,
                      otp: sOTP
                    }
        })
        if (!response || response.data.type !== 'success') return { isSuccess: false, message: response.data.message || response.data }
        return { isSuccess: true, message: 'OTP sent successfully!' }
      } catch (error) {
        console.log('Send Otp Error: ' + error.message)
      }
    } else if (sAction === 'verify') {
      try {
        const response = await axios.get('https://api.msg91.com/api/v5/otp/verify', {
          params:
                        {
                          mobile: `91${sPhone}`,
                          authkey: config.MSG91_AUTH_KEY,
                          otp: sOTP
                        }
        })
        if (!response || response.data.type !== 'success') return { isSuccess: false, message: response.data.message || response.data }

        const data = response.data && response.data.type === 'success'
          ? { isSuccess: true, message: 'OTP verified successfully!' }
          : { isSuccess: false, message: 'OTP verification failed!' }

        return data
      } catch (error) {
        console.log('Verify otp giving error: ' + error.message)
      }
    } else {
      return { isSuccess: false, message: 'Invalid action!' }
    }
  } catch (error) {
    console.log('msg91SendOrVerifyOTP function giving error: ' + error.message)
  }
}

module.exports = {
  sendOTPFromProvider
}
