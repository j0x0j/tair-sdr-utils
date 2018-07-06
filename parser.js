const fs = require('fs')
const parse = require('csv-parse')
const parser = parse({ delimiter: ',' })
const transform = require('stream-transform')
const path = require('path')
const stream = fs.createReadStream(path.join(__dirname, '/matches_11-6.log.csv'))
const writeStream = fs.createWriteStream(path.join(__dirname, '/parsed_matches_11-6.log.csv'))
const lock = {}
const LOCKTIME = 60 * 1000 * 5

parser.on('error', function (err) {
  console.log(err.message)
})

const transformer = transform(record => {
  const station = record[0]
  const creative = record[2]
  const ts = record[4]
  const date = new Date(ts)
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
    return record.join(';') + '\n'
  } else {
    // if not first get ellapsed from first of set
    const lockDate = lock[station][creative].getMilliseconds()
    // if ellapsed > than lock time, unlock
    // if ellapsed < than lock time, noop
    if ((date.getMilliseconds() - lockDate) > LOCKTIME) {
      // Counts as match
      // Set new lock
      lock[station][creative] = date
      return record.join(';') + '\n'
    }
  }
}, { parallel: 1 })

stream.pipe(parser).pipe(transformer).pipe(writeStream)
