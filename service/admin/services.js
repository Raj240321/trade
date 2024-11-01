const Users = require('../../models/users.model')
const config = require('../../config/config')
const mongoose = require('mongoose')
const { ObjectId } = mongoose.Types
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const { blackListToken } = require('../../helper/redis')
const crypto = require('crypto') // For generating a random string
const Transaction = require('../../models/transaction.model')

class AdminService {
  // Create a new admin user
  async createAdmin(req, res) {
    try {
      const { id, role } = req.admin
      const { name, password, limit = 0, balanceLimit = 0 } = req.body
      const admin = await Users.findOne({ _id: new ObjectId(id), isAdmin: true, isActive: true }).lean()
      if (!admin) return res.status(400).jsonp({ status: 400, message: 'permission denied.' })

      let userRole
      const obj = {}
      if (role === 'superMaster') {
        userRole = 'master'
        obj.superMasterId = new ObjectId(id)
      } else if (role === 'master') {
        userRole = 'broker'
        obj.superMasterId = new ObjectId(admin.superMasterId)
        obj.masterId = new ObjectId(id)
      } else if (role === 'broker') {
        userRole = 'user'
        obj.superMasterId = new ObjectId(admin.superMasterId)
        obj.masterId = new ObjectId(admin.masterId)
        obj.brokerId = new ObjectId(id)
      } else {
        return res.status(400).jsonp({ status: 400, message: 'permission denied' })
      }

      if (['broker', 'master'].includes(role) && (admin.createCount >= admin.createLimit)) {
        return res.status(400).jsonp({ status: 400, message: 'You have reached the limit for creating users.' })
      }

      let code = await generateCode()
      if (code.isError) {
        return res.status(400).jsonp({ status: 400, message: code.message })
      } else {
        code = code.uniqueCode
      }

      const checkExists = await Users.findOne({ code }).lean()
      if (checkExists) {
        return res.status(400).jsonp({ status: 400, message: 'User already exists.' })
      }

      const hashedPassword = await bcrypt.hash(password, 10)
      const createUser = {
        name,
        code,
        password: hashedPassword,
        role: userRole,
        createLimit: limit,
        balanceLimit,
        isAdmin: userRole !== 'user',
        ...obj
      }
      const user = await Users.create(createUser)
      // Increment creation count for Masters and Brokers, but not for HeadMaster
      if (role === 'master' || role === 'broker') {
        await Users.updateOne({ _id: new ObjectId(id) }, { $inc: { createCount: 1 } })
      }
      return res.status(200).jsonp({
        status: 200,
        message: 'created successfully.',
        data: {
          _id: user._id,
          name,
          code,
          userRole
        }
      })
    } catch (error) {
      console.error('AdminService.createAdmin', error.message)
      return res.status(500).jsonp({ status: 500, message: error.message || 'Something went wrong!' })
    }
  }

  // Admin login
  async adminLogin(req, res) {
    try {
      const { code, password } = req.body

      // Find admin by code and ensure they are active
      const admin = await Users.findOne({ code, isAdmin: true, isActive: true }).lean()
      if (!admin || !(await bcrypt.compare(password, admin.password))) {
        return res.status(401).jsonp({ status: 401, message: 'Invalid code or password.' })
      }

      // Generate JWT token
      let token
      try {
        token = jwt.sign(
          { id: admin._id, role: admin.role, isAdmin: admin.isAdmin, isTrade: admin.isTrade },
          config.JWT_ADMIN_SECRET,
          { expiresIn: config.JWT_VALIDITY }
        )
      } catch (error) {
        console.error('JWT Signing Error:', error.message)
        return res.status(500).jsonp({ status: 500, message: 'Token generation failed. Please try again.' })
      }

      const newToken = { token, timeStamp: new Date() }

      // Update admin with new login time and JWT token, trimming array if limit is exceeded
      const updateQuery = { $push: { jwtTokens: { $each: [newToken], $slice: -config.LOGIN_HARD_LIMIT_ADMIN } }, $set: { loginAt: new Date() } }

      await Users.updateOne({ _id: admin._id }, updateQuery)

      return res.status(200).jsonp({
        status: 200,
        message: 'Login successful.',
        data: { token, role: admin.role, name: admin.name }
      })
    } catch (error) {
      console.error('Admin.adminLogin', error.message)
      return res.status(500).jsonp({ status: 500, message: error.message || 'Something went wrong!' })
    }
  }

  // Change password
  async changePassword(req, res) {
    try {
      const { id } = req.admin
      const { oldPassword, newPassword } = req.body

      // Find admin user by ID
      const admin = await Users.findOne({ _id: new ObjectId(id), isActive: true })
      if (!admin) {
        return res.status(400).jsonp({ status: 400, message: 'Permission denied.' })
      }

      // Verify old password
      const isMatch = await bcrypt.compare(oldPassword, admin.password)
      if (!isMatch) {
        return res.status(401).jsonp({ status: 401, message: 'Invalid old password.' })
      }

      // Hash new password and update
      const hashedPassword = await bcrypt.hash(newPassword, 10)
      await Users.updateOne({ _id: new ObjectId(id) }, { password: hashedPassword })

      return res.status(200).jsonp({ status: 200, message: 'Password changed successfully.' })
    } catch (error) {
      console.error('Admin.changePassword', error.message)
      return res.status(500).jsonp({ status: 500, message: error.message || 'Something went wrong!' })
    }
  }

  // List admins based on permissions
  async listAdmin(req, res) {
    try {
      const { id, role } = req.admin // Extracting admin's id and role from the request
      const { page = 1, limit = 10, masterId, brokerId, search } = req.query

      // Initialize a filter based on admin roles and their created hierarchy
      const filter = {}
      if (search) {
        filter.name = { $regex: search, $options: 'i' }
      }
      if (role === 'superMaster') {
        // SuperMaster: Can view all Masters, all Brokers, or all Users
        if (masterId) {
          filter.role = 'broker'
          filter.masterId = masterId // If specific Master ID is provided
        } else if (req.query.type === 'broker') {
          filter.role = 'broker' // Get all Brokers
        } else if (req.query.type === 'user') {
          filter.role = 'user' // Get all Users
        } else {
          filter.role = 'master' // Default to fetching all Masters
        }
      } else if (role === 'master') {
        // Master: Can view Brokers created by them, or Users created by a specific Broker
        if (brokerId) {
          filter.role = 'user'
          filter.brokerId = brokerId
          filter.masterId = new ObjectId(id) // Include only users created by this Master
        } else {
          filter.role = 'broker'
          filter.masterId = new ObjectId(id) // Include only brokers created by this Master
        }
      } else if (role === 'broker') {
        // Broker: Can only view Users created by them
        filter.role = 'user'
        filter.brokerId = new ObjectId(id) // Include only users created by this Broker
      } else {
        return res.status(400).jsonp({ status: 400, message: 'Permission denied' })
      }

      // Pagination and query based on filter
      const records = await Users.find(filter, { password: 0, jwtTokens: 0, isAdmin: 0 })
        .sort({ createdAt: -1 })
        .skip((page - 1) * parseInt(limit))
        .limit(parseInt(limit))
        .lean()

      const total = await Users.countDocuments(filter)

      return res.status(200).jsonp({
        status: 200,
        message: 'Admin list fetched successfully.',
        data: { records, total }
      })
    } catch (error) {
      console.error('Admin.listAdmin', error.message)
      return res.status(500).jsonp({ status: 500, message: error.message || 'Something went wrong!' })
    }
  }

  // Logout
  async logout(req, res) {
    try {
      const { id } = req.admin
      const token = req.header('Authorization')

      if (!token) {
        return res.status(400).jsonp({ status: 400, message: 'Token not provided.' })
      }

      // Remove token from user tokens array
      await Users.updateOne({ _id: new ObjectId(id) }, { $pull: { aJwtTokens: { token } } })

      // Blacklist token (add error handling if needed)
      try {
        blackListToken(token)
      } catch (error) {
        console.error('Error blacklisting token:', error.message)
      }

      return res.status(200).jsonp({ status: 200, message: 'Logout successful.' })
    } catch (error) {
      console.error('Admin.logout', error.message)
      return res.status(500).jsonp({ status: 500, message: error.message || 'Something went wrong!' })
    }
  }

  async addBalance(req, res) {
    const session = await mongoose.startSession()
    session.startTransaction()
    let targetUser
    const { id, role } = req.admin // Extracting admin's id and role from the request
    const { code, amount, reason = '' } = req.body // User ID to add balance and the amount to add

    try {
      // Input validation
      if (!code || !amount || amount <= 0) {
        await session.abortTransaction()
        session.endSession()
        return res.status(400).json({ status: 400, message: 'Invalid user code or amount.' })
      }

      // Find the target user (Broker or User) to update the balance
      targetUser = await Users.findOne({ code, isActive: true, isTrade: true }).session(session)
      if (!targetUser) {
        await session.abortTransaction()
        session.endSession()
        return res.status(404).json({ status: 404, message: 'User not found.' })
      }

      // Check if the user was created by the admin
      const userNotCreatedByAdmin =
        (role === 'superMaster' && targetUser.role === 'master' && targetUser.superMasterId.toString() !== id) ||
        (role === 'master' && targetUser.role === 'broker' && targetUser.masterId.toString() !== id) ||
        (role === 'broker' && targetUser.role === 'user' && targetUser.brokerId.toString() !== id)

      if (userNotCreatedByAdmin) {
        await session.abortTransaction()
        session.endSession()
        return res.status(403).json({ status: 403, message: 'You can only add balance to users that you created.' })
      }

      // Determine balance limit based on the user's role
      const balanceLimit = targetUser.balanceLimit

      // Check if the new balance exceeds the limit
      const newBalance = targetUser.balance + amount
      if (newBalance > balanceLimit) {
        await session.abortTransaction()
        session.endSession()
        return res.status(400).json({
          status: 400,
          message: `Balance limit exceeded. The maximum allowed balance for this user is ${balanceLimit}.`
        })
      }

      // Create a transaction entry for the balance addition
      const transactionData = {
        code: targetUser.code,
        actionOn: targetUser._id,
        actionBy: id,
        actionName: reason, // Customize based on enum for clarity
        type: 'CREDIT',
        transactionId: new mongoose.Types.ObjectId(),
        transactionStatus: 'SUCCESS',
        beforeBalance: targetUser.balance,
        amount,
        afterBalance: newBalance
      }

      // Conditionally add role-specific IDs based on both targetUser and admin roles
      if (role === 'superMaster' && targetUser.role === 'master') {
        transactionData.superMasterId = id
      } else if (role === 'master' && targetUser.role === 'broker') {
        transactionData.superMasterId = targetUser.superMasterId
        transactionData.masterId = id
      } else if (role === 'broker' && targetUser.role === 'user') {
        transactionData.superMasterId = targetUser.superMasterId
        transactionData.masterId = targetUser.masterId
        transactionData.brokerId = id
      }

      const transaction = new Transaction(transactionData)

      // Update the user's balance and save both the user and transaction documents atomically
      targetUser.balance = newBalance
      await targetUser.save({ session })
      await transaction.save({ session })

      await session.commitTransaction()
      session.endSession()

      // Return success response
      return res.status(200).json({
        status: 200,
        message: 'Balance added successfully.',
        data: { userId: targetUser._id, newBalance }
      })
    } catch (error) {
      await session.abortTransaction()
      session.endSession()
      console.error('Admin.addBalance', error.message)

      // Log failed transaction if balance update fails (without session for safety)
      const failedTransactionData = {
        code: req.body.code,
        actionOn: targetUser ? targetUser._id : null,
        actionBy: req.admin.id,
        actionName: reason,
        type: 'CREDIT',
        transactionId: new mongoose.Types.ObjectId(),
        transactionStatus: 'FAILED',
        beforeBalance: targetUser ? targetUser.balance : 0,
        amount: req.body.amount,
        afterBalance: targetUser ? targetUser.balance : 0,
        responseCode: error.code || 'INTERNAL_ERROR'
      }

      // Conditionally add role-specific IDs for failed transaction based on roles
      if (role === 'superMaster' && targetUser.role === 'master') {
        failedTransactionData.superMasterId = id
      } else if (role === 'master' && targetUser.role === 'broker') {
        failedTransactionData.superMasterId = targetUser.superMasterId
        failedTransactionData.masterId = id
      } else if (role === 'broker' && targetUser.role === 'user') {
        failedTransactionData.superMasterId = targetUser.superMasterId
        failedTransactionData.masterId = targetUser.masterId
        failedTransactionData.brokerId = id
      }

      const failedTransaction = new Transaction(failedTransactionData)
      await failedTransaction.save()

      return res.status(500).json({
        status: 500,
        message: error.message || 'Something went wrong!'
      })
    }
  }

  async withdrawBalance(req, res) {
    const session = await mongoose.startSession()
    session.startTransaction()
    let targetUser
    const { id, role } = req.admin // Extracting admin's id and role from the request
    const { code, amount, reason = '' } = req.body // User ID to withdraw balance and the amount to withdraw

    try {
      // Input validation
      if (!code || !amount || amount <= 0) {
        await session.abortTransaction()
        session.endSession()
        return res.status(400).json({ status: 400, message: 'Invalid user code or amount.' })
      }

      // Find the target user (Broker or User) to update the balance
      targetUser = await Users.findOne({ code, isActive: true, isTrade: true }).session(session)
      if (!targetUser) {
        await session.abortTransaction()
        session.endSession()
        return res.status(404).json({ status: 404, message: 'User not found.' })
      }

      // Check if the user was created by the admin
      const userNotCreatedByAdmin =
        (role === 'superMaster' && targetUser.role === 'master' && targetUser.superMasterId.toString() !== id) ||
        (role === 'master' && targetUser.role === 'broker' && targetUser.masterId.toString() !== id) ||
        (role === 'broker' && targetUser.role === 'user' && targetUser.brokerId.toString() !== id)

      if (userNotCreatedByAdmin) {
        await session.abortTransaction()
        session.endSession()
        return res.status(403).json({ status: 403, message: 'You can only withdraw balance from users that you created.' })
      }

      // Check if the current balance is sufficient for the withdrawal
      const newBalance = targetUser.balance - amount
      if (newBalance < 0) {
        await session.abortTransaction()
        session.endSession()
        return res.status(400).json({
          status: 400,
          message: 'Insufficient balance for this transaction.'
        })
      }

      // Create a transaction entry for the balance withdrawal
      const transactionData = {
        code: targetUser.code,
        actionOn: targetUser._id,
        actionBy: id,
        actionName: reason, // Customize based on enum for clarity
        type: 'DEBIT',
        transactionId: new mongoose.Types.ObjectId(),
        transactionStatus: 'SUCCESS',
        beforeBalance: targetUser.balance,
        amount,
        afterBalance: newBalance
      }

      // Conditionally add role-specific IDs based on both targetUser and admin roles
      if (role === 'superMaster' && targetUser.role === 'master') {
        transactionData.superMasterId = id
      } else if (role === 'master' && targetUser.role === 'broker') {
        transactionData.superMasterId = targetUser.superMasterId
        transactionData.masterId = id
      } else if (role === 'broker' && targetUser.role === 'user') {
        transactionData.superMasterId = targetUser.superMasterId
        transactionData.masterId = targetUser.masterId
        transactionData.brokerId = id
      }

      const transaction = new Transaction(transactionData)

      // Update the user's balance and save both the user and transaction documents atomically
      targetUser.balance = newBalance
      await targetUser.save({ session })
      await transaction.save({ session })

      await session.commitTransaction()
      session.endSession()

      // Return success response
      return res.status(200).json({
        status: 200,
        message: 'Balance withdrawn successfully.',
        data: { userId: targetUser._id, newBalance }
      })
    } catch (error) {
      await session.abortTransaction()
      session.endSession()
      console.error('Admin.withdrawBalance', error.message)

      // Log failed transaction if balance update fails (without session for safety)
      const failedTransactionData = {
        code: req.body.code,
        actionOn: targetUser ? targetUser._id : null,
        actionBy: req.admin.id,
        actionName: reason,
        type: 'DEBIT',
        transactionId: new mongoose.Types.ObjectId(),
        transactionStatus: 'FAILED',
        beforeBalance: targetUser ? targetUser.balance : 0,
        amount: req.body.amount,
        afterBalance: targetUser ? targetUser.balance : 0,
        responseCode: error.code || 'INTERNAL_ERROR'
      }

      // Conditionally add role-specific IDs for failed transaction based on roles
      if (role === 'superMaster' && targetUser.role === 'master') {
        failedTransactionData.superMasterId = id
      } else if (role === 'master' && targetUser.role === 'broker') {
        failedTransactionData.superMasterId = targetUser.superMasterId
        failedTransactionData.masterId = id
      } else if (role === 'broker' && targetUser.role === 'user') {
        failedTransactionData.superMasterId = targetUser.superMasterId
        failedTransactionData.masterId = targetUser.masterId
        failedTransactionData.brokerId = id
      }

      const failedTransaction = new Transaction(failedTransactionData)
      await failedTransaction.save()

      return res.status(500).json({
        status: 500,
        message: error.message || 'Something went wrong!'
      })
    }
  }

  // Edit user information based on user roles and creation relationship
  async updateInfo(req, res) {
    try {
      const { id, role } = req.admin // Extracting admin's id and role from the request
      const { code, name, isActive, createLimit, balanceLimit, isTrade } = req.body // User data to update

      // Find the target user (Broker or User) to update
      const targetUser = await Users.findOne({ code }).lean()
      if (!targetUser) {
        return res.status(404).json({ status: 404, message: 'User not found.' })
      }

      // Check if the user was created by the admin
      if ((role === 'superMaster' && targetUser.role === 'master' && targetUser.superMasterId.toString() !== id) ||
        (role === 'master' && targetUser.role === 'broker' && targetUser.masterId.toString() !== id) ||
        (role === 'broker' && targetUser.role === 'user' && targetUser.brokerId.toString() !== id) ||
        (role === 'user' && targetUser._id.toString() !== id)) {
        return res.status(403).json({ status: 403, message: 'You can only edit users that you created.' })
      }

      // Update the user's name if provided
      if (name) {
        targetUser.name = name
      }

      // Check if the user is trying to update isActive status
      if (isActive !== undefined) {
        targetUser.isActive = isActive
      }

      // Check if the user is trying to update createLimit and balanceLimit
      if (role !== 'user') { // Only SuperMaster and Master can update limits
        if (createLimit !== undefined) {
          targetUser.createLimit = createLimit
        }
        if (balanceLimit !== undefined) {
          targetUser.balanceLimit = balanceLimit
        }
      }

      // Allow changing isTrade status
      if (role !== 'user' && isTrade !== undefined) { // Only SuperMaster, Master, and Broker can change isTrade
        targetUser.isTrade = isTrade
      }

      // Save the updated user information
      await targetUser.save()

      return res.status(200).json({
        status: 200,
        message: 'User information updated successfully.',
        data: targetUser
      })
    } catch (error) {
      console.error('Admin.updateInfo', error.message)
      return res.status(500).json({ status: 500, message: error.message || 'Something went wrong!' })
    }
  }

  // Get user information based on user code
  async getInfo(req, res) {
    try {
      const { code } = req.params // User code to fetch info
      const { id, role } = req.admin // Extracting admin's id and role from the request

      // Find the target user (Broker, User, or Master) based on the code
      const targetUser = await Users.findOne({ code }).lean()
      if (!targetUser) {
        return res.status(404).json({ status: 404, message: 'User not found.' })
      }

      // Check if the requesting user has permission to view this user’s info
      const hasAccess =
      (role === 'superMaster' && (targetUser.role === 'master' || targetUser.role === 'broker' || targetUser.role === 'user')) ||
      (role === 'master' && (targetUser.role === 'broker' || targetUser.role === 'user') && targetUser.masterId.toString() === id) ||
      (role === 'broker' && targetUser.role === 'user' && targetUser.brokerId.toString() === id) ||
      (role === 'user' && targetUser._id.toString() === id) // Users can only see their own info

      if (!hasAccess) {
        return res.status(403).json({ status: 403, message: 'You do not have permission to access this user\'s information.' })
      }

      // Prepare the user data to send back (excluding sensitive fields if necessary)
      const userInfo = {
        id: targetUser._id,
        name: targetUser.name,
        code: targetUser.code,
        role: targetUser.role,
        balance: targetUser.balance,
        isActive: targetUser.isActive,
        isTrade: targetUser.isTrade,
        createLimit: targetUser.createLimit,
        balanceLimit: targetUser.balanceLimit,
        createdAt: targetUser.createdAt,
        updatedAt: targetUser.updatedAt
      }

      return res.status(200).json({
        status: 200,
        message: 'User information retrieved successfully.',
        data: userInfo
      })
    } catch (error) {
      console.error('Admin.getInfo', error.message)
      return res.status(500).json({ status: 500, message: error.message || 'Something went wrong!' })
    }
  }

  // user login
  async userLogin(req, res) {
    try {
      const { code, password, serverCode = 100 } = req.body

      // Find admin by code and ensure they are active
      const user = await Users.findOne({ code, isActive: true, isTrade: true }).lean()
      if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).jsonp({ status: 401, message: 'Invalid code or password.' })
      }

      if (serverCode !== 2000) {
        return res.status(401).jsonp({ status: 401, message: 'Invalid server code.' })
      }
      // Generate JWT token
      let token
      try {
        token = jwt.sign(
          { id: user._id, role: user.role, isAdmin: user.isAdmin, isTrade: user.isTrade },
          config.JWT_ADMIN_SECRET,
          { expiresIn: config.JWT_VALIDITY }
        )
      } catch (error) {
        console.error('JWT Signing Error:', error.message)
        return res.status(500).jsonp({ status: 500, message: 'Token generation failed. Please try again.' })
      }

      const newToken = { token, timeStamp: new Date() }

      // Update admin with new login time and JWT token, trimming array if limit is exceeded
      const updateQuery = { $push: { jwtTokens: { $each: [newToken], $slice: -config.LOGIN_HARD_LIMIT_ADMIN } }, $set: { loginAt: new Date() } }

      await Users.updateOne({ _id: user._id }, updateQuery)

      return res.status(200).jsonp({
        status: 200,
        message: 'Login successful.',
        data: { token, role: user.role, name: user.name }
      })
    } catch (error) {
      console.error('Admin.userLogin', error.message)
      return res.status(500).jsonp({ status: 500, message: error.message || 'Something went wrong!' })
    }
  }

  async getProfile(req, res) {
    try {
      const { id } = req.admin
      const admin = await Users.findById(id, { password: 0, jwtTokens: 0 }).lean()
      if (!admin) {
        return res.status(404).jsonp({ status: 404, message: 'not found.' })
      }
      return res.status(200).jsonp({ status: 200, message: 'profile fetched successfully.', data: admin })
    } catch (error) {
      console.error('Admin.getProfile', error.message)
      return res.status(500).jsonp({ status: 500, message: error.message || 'Something went wrong!' })
    }
  }
}

module.exports = new AdminService()

function generateRandomCode(length = 8) {
  return crypto.randomBytes(length).toString('hex').slice(0, length).toUpperCase()
}

// API to generate a unique user code
async function generateCode() {
  try {
    let uniqueCode
    let isUnique = false

    // Loop until a unique code is generated
    while (!isUnique) {
      // Generate a random code with the desired length (adjust length if necessary)
      uniqueCode = generateRandomCode(6)

      // Check if the code already exists in the database
      const codeExists = await Users.findOne({ code: uniqueCode }).lean()
      if (!codeExists) {
        isUnique = true // Exit loop if code is unique
      }
    }

    return {
      isError: false,
      uniqueCode: uniqueCode
    }
  } catch (error) {
    console.error('Error generating code:', error.message)
    return {
      isError: true
    }
  }
}
