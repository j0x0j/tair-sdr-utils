const fs = require('fs')
const kue = require('kue')
const dotenv = require('dotenv')
const request = require('request-promise')
const path = require('path')
const { checkLogLock, prettyLog } = require('./logUtils')
const jobs = kue.createQueue()
const log = fs.createWriteStream(path.join(__dirname, '/matches.log'), { flags: 'w' })
const aws = require('aws-sdk')
const s3 = new aws.S3({apiVersion: '2006-03-01'});

const config = dotenv.load().parsed
const ACCEPTED_CONFIDENCE = +config.ACCEPTED_CONFIDENCE
const CONCURRENT_JOBS = +config.CONCURRENT_JOBS
const S3_BUCKET = config.S3_BUCKET
const DEVICE = config.DEVICE

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
          market: job.data.market,
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
        const s3Path = 'devices/' + DEVICE + '/' + job.data.stn + '/samples/' + `sample_${job.data.uuid}_${job.data.timestamp}.wav`
        request(options)
          .then(bmpRes => {
            const s3Params = {
              Bucket: S3_BUCKET,
              Key: '',
              Body: ''
            };
            const fileStream = fs.createReadStream(SAMPLE_PATH)
            fileStream.on('error', (fsErr) => {
              done(fsErr)
            })
            s3Params.Body = fileStream
            s3Params.Key = s3Path
            s3.upload(s3Params, (s3Err, response) => {
              if (s3Err) done(s3Err)
              fs.unlink(SAMPLE_PATH, (err) => {
                done(err)
              })
            })
          })
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
