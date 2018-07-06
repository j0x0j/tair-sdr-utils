const fs = require('fs')
const kue = require('kue')
const dotenv = require('dotenv')
const request = require('request-promise')
const path = require('path')
const { prettyLog } = require('./logUtils')
const jobs = kue.createQueue()
const log = fs.createWriteStream(path.join(__dirname, '/matches.log'), { flags: 'w' })
const aws = require('aws-sdk')
const s3 = new aws.S3({apiVersion: '2006-03-01'});

const config = dotenv.load().parsed
const CONCURRENT_JOBS = +config.CONCURRENT_JOBS
const S3_BUCKET = config.S3_BUCKET
const DEVICE = config.DEVICE
const BMP_HOST = 'bmp.tair.network'

jobs.process('match', CONCURRENT_JOBS, (job, done) => {
  prettyLog('New match Job:', job.data.uuid)
  const s3Path = 'devices/' + DEVICE + '/' + job.data.station + '/matches/' + `match_${job.data.song_id}_${job.data.timestamp}.wav`
  const s3Params = {
    Bucket: S3_BUCKET,
    Key: '',
    Body: ''
  };
  const fileStream = fs.createReadStream(job.data.file_path)
  fileStream.on('error', (fsErr) => {
    done(fsErr)
  })
  s3Params.Body = fileStream
  s3Params.Key = s3Path
  s3.upload(s3Params, (s3Err, response) => {
    if (s3Err) done(s3Err)
    prettyLog('file uploaded to s3 for: ', job.data.song_name)
    prettyLog("s3 Response: ")
    prettyLog(response)
    // TODO: add this back in when all is working: fs.unlink(job.data.file_path)
    // post the match to the BMP
    const body = {
      station: job.data.station,
      creative: job.data.song_name,
      market: job.data.market,
      s3Path: s3Path,
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
      .then(bmpRes => {
        done()
      })
      .catch(bmpErr => { done(bmpErr) })
  })
})
