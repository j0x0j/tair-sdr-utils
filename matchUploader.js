const fs = require('fs')
const kue = require('kue')
const dotenv = require('dotenv')
const request = require('request')
const { prettyLog } = require('./logUtils')
const jobs = kue.createQueue()
const aws = require('aws-sdk')
const config = dotenv.load().parsed

if (config.AWS_KEY && config.AWS_SECRET) {
  aws.config.update({
    accessKeyId: config.AWS_KEY,
    secretAccessKey: config.AWS_SECRET
  })
}

const s3 = new aws.S3({ apiVersion: '2006-03-01' })
const S3_BUCKET = config.S3_BUCKET
const DEVICE = config.DEVICE
const BMP_HOST = 'bmp.tair.network'

jobs.process('match', 1, (job, done) => {
  prettyLog('New match Job:', job.data.uuid)
  // Handle failure backoff
  job.attempts(3).backoff({ type: 'exponential' })
  const s3Path = 'devices/' + DEVICE + '/' + job.data.station + '/matches/' + `match_${job.data.song_id}_${job.data.timestamp}.wav`
  const s3Params = {
    ACL: 'public-read',
    Bucket: S3_BUCKET,
    Key: '',
    Body: ''
  }

  fs.readFile(job.data.file_path, (err, buff) => {
    if (err) {
      return done(err)
    }
    s3Params.Body = buff
    s3Params.Key = s3Path

    s3.upload(s3Params, (s3Err, response) => {
      if (s3Err) return done(s3Err)
      prettyLog('file uploaded to s3 for:', job.data.song_name)
      prettyLog('s3 path: ', s3Path)
      prettyLog('s3 response: ', response)
      fs.unlinkSync(job.data.file_path)
      // post the match to the BMP:
      const body = {
        station: job.data.station,
        market: job.data.market,
        creative: job.data.creative,
        filePath: s3Path,
        timestamp: new Date(job.data.timestamp).toISOString(),
        nodeName: DEVICE
      }
      if (process.env.NODE_ENV === 'test') {
        console.log('Send match to BMP:', body)
        done()
      } else {
        const options = {
          method: 'POST',
          uri: `http://${BMP_HOST}/api/match`,
          resolveWithFullResponse: true,
          json: true,
          body
        }
        request(options, (bmpErr) => { done(bmpErr) })
      }
    })
  })
})
