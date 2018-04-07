const fs = require('fs')
const kue = require('kue')
const dotenv = require('dotenv')
const request = require('request-promise')
const path = require('path')
const { checkLogLock, prettyLog } = require('./logUtils')
const jobs = kue.createQueue()
const log = fs.createWriteStream(path.join(__dirname, '/matches.log'), { flags: 'w' })

const config = dotenv.load().parsed
const ACCEPTED_CONFIDENCE = +config.ACCEPTED_CONFIDENCE
const CONCURRENT_JOBS = +config.CONCURRENT_JOBS

const DEJAVU_HOST = 'dejavu.tair.network'
const BMP_HOST = 'bmp.tair.network'

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
      log.write(`${job.data.stn};${data.confidence};${data.song_name};${job.data.uuid};${job.data.timestamp}` + '\n')
      // Check if creative is locked
      // Send matched if properly parsed = not locked
      if (checkLogLock(job.data.stn, data.song_name, job.data.uuid, job.data.timestamp)) {
        prettyLog('IS NOT LOCKED, SEND MATCH', job.data.uuid)
        const body = {
          station: job.data.stn,
          creative: data.song_name,
          sample: job.data.uuid,
          createdAt: job.data.timestamp
        }
        const options = {
          method: 'POST',
          uri: `http://${BMP_HOST}/log`,
          resolveWithFullResponse: true,
          json: true,
          body
        }
        request(options)
          .then(bmpRes => { done() })
          .catch(bmpErr => { done(bmpErr) })
      } else {
        done()
      }
    } else {
      console.log('Didn\'t match')
      fs.unlink(SAMPLE_PATH, (err) => {
        done(err)
      })
    }
  })
})

kue.app.listen(3000)
