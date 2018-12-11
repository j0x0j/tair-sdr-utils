const fs = require('fs')
const Throttle = require('throttle')

const throttle = new Throttle(44100)
const readStream = fs.createReadStream(process.env.TEST_FILE_PATH)

readStream.pipe(throttle).pipe(process.stdout)
