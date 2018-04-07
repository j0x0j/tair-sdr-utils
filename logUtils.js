const dotenv = require('dotenv')
const config = dotenv.load().parsed
const MATCH_LOCK_MINUTES = +config.MATCH_LOCK_MINUTES

const lock = {}
const LOCKTIME = 60 * 1000 * MATCH_LOCK_MINUTES

const Utils = {}

function checkLogLock (station, creative, sampleId, timestamp) {
  // lock is combination of creative and station
  // check if station is in lock object
  if (!lock[station]) {
    lock[station] = {}
  }
  // check if is first of set (is locked)
  // if first lock set
  if (!lock[station][creative]) {
    // Counts as match
    lock[station][creative] = timestamp
    return true
  } else {
    // if not first get ellapsed from first of set
    const lockDate = new Date(lock[station][creative])
    // if ellapsed > than lock time, unlock
    // if ellapsed < than lock time, noop
    if ((new Date(timestamp) - lockDate) > LOCKTIME) {
      // Counts as match
      // Set new lock
      lock[station][creative] = timestamp
      return true
    } else {
      return false
    }
  }
}

function prettyLog (key, value = '') {
  console.log('.')
  console.log(key, value)
  console.log('.')
}

Utils.checkLogLock = checkLogLock
Utils.prettyLog = prettyLog

module.exports = Utils
