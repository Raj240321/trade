const nodemailer = require('nodemailer')
const config = require('../config/config')
const transporter = nodemailer.createTransport(config.MAIL_TRANSPORTER)
const { handleCatchError } = require('./utilities.services')

const sendMail = async ({ sSubject, emailBody, to }) => {
  try {
    const nodeMailerOptions = {
      from: `${config.CLIENT_NAME} ${config.SMTP_FROM}`,
      to: to,
      subject: sSubject,
      html: emailBody
    }
    const bEmail = await validateEmail(to)
    if (to && bEmail) {
      return await transporter.sendMail(nodeMailerOptions)
    }
    return
  } catch (error) {
    handleCatchError(error)
  }
}

async function validateEmail (email) {
  // eslint-disable-next-line no-useless-escape
  const sRegexEmail = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/
  return !!(email.match(sRegexEmail))
}

module.exports = {
  sendMail
}
