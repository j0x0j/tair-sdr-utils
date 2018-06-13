const fs = require('fs')
const kue = require('kue')
const dotenv = require('dotenv')
const request = require('request-promise')
const path = require('path')
const { prettyLog } = require('./logUtils')
const jobs = kue.createQueue()
const log = fs.createWriteStream(path.join(__dirname, '/matches.log'), { flags: 'w' })

const config = dotenv.load().parsed
const ACCEPTED_CONFIDENCE = +config.ACCEPTED_CONFIDENCE
const CONCURRENT_JOBS = +config.CONCURRENT_JOBS

const DEJAVU_HOST = 'dejavu.tair.network'

jobs.process('sample', CONCURRENT_JOBS, (job, done) => {
  prettyLog('New Sample Job:', job.data.uuid)
  const SAMPLE_PATH = path.join(__dirname, `/samples/sample_${job.data.uuid}.wav`)
  const options = {
    method: 'POST',
    uri: `http://${DEJAVU_HOST}/sample`,
    formData: {
      file: fs.createReadStream(SAMPLE_PATH)
    }
  }
  request(options, (err, res, body) => {
    if (err) throw err
    const data = JSON.parse(body)
    console.log(data)
    if (
      data &&
      data.confidence &&
      data.confidence >= ACCEPTED_CONFIDENCE
    ) {
      // is a match, should do further processing
      // Log to local file before filtering
      log.write(`${job.data.uuid}` + '\n')
      done()
    } else {
      console.log('Didn\'t match')
      done()
    }
  })
})

kue.app.listen(3000)
