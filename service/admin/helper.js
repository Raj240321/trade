const Admin = require('../../models/users.model')
const { ObjectId } = require('mongoose').Types

// Reusable method to check admin existence and permissions
async function getAdminById(adminId, isMaster = false) {
  const admin = await Admin.findOne({ _id: new ObjectId(adminId), isAdmin: true, isActive: true })
  if (!admin) throw new Error('Authentication failed. Please login again!')
  if (isMaster && admin.role !== 'master') throw new Error('Permission denied.')
  return admin
}

// Permission checks
function hasAdminPermission(admin, role) {
  if (role === 'admin') return admin.role === 'master'
  if (role === 'subAdmin') return admin.subAdminPermission
  if (role === 'user') return admin.userPermission
  return false
}

module.exports = {
  getAdminById,
  hasAdminPermission
}
