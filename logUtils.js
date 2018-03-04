const lock = {}
const LOCKTIME = 60 * 1000 * 5

const Utils = {}

function checkLogLock (station, creative, sampleId, date) {
  // lock is combination of creative and station
  // check if station is in lock object
  if (!lock[station]) {
    lock[station] = {}
  }
  // check if is first of set (is locked)
  // if first lock set
  if (!lock[station][creative]) {
    // Counts as match
    lock[station][creative] = date
    return true
  } else {
    // if not first get ellapsed from first of set
    const lockDate = lock[station][creative].getMilliseconds()
    // if ellapsed > than lock time, unlock
    // if ellapsed < than lock time, noop
    if ((date.getMilliseconds() - lockDate) > LOCKTIME) {
      // Counts as match
      // Set new lock
      lock[station][creative] = date
      return true
    } else {
      return false
    }
  }
}

Utils.checkLogLock = checkLogLock

module.exports = Utils
