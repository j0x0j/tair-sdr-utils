const fs = require('fs')
const kue = require('kue')
const dotenv = require('dotenv')
const config = dotenv.load().parsed
const { prettyLog } = require('./logUtils')
const aws = require('aws-sdk')

if (config.AWS_KEY && config.AWS_SECRET) {
  aws.config.update({
    accessKeyId: config.AWS_KEY,
    secretAccessKey: config.AWS_SECRET
  })
}

const s3 = new aws.S3({ apiVersion: '2006-03-01' })
const jobs = kue.createQueue()

const CONCURRENT_JOBS = +config.CONCURRENT_JOBS
const S3_BUCKET = config.S3_BUCKET
const DEVICE = config.DEVICE

jobs.process('scrape', CONCURRENT_JOBS, (job, done) => {
  prettyLog('New Scrape:', job.data.uuid)
  const scrapePath = `./scrapes/scrape_${job.data.uuid}.wav`
  const s3Path = 'devices/' + DEVICE + '/' + job.data.stn + '/scrapes/' + `scrape_${job.data.uuid}_${job.data.timestamp}.wav`
  const s3Params = {
    Bucket: S3_BUCKET,
    Key: '',
    Body: ''
  }
  const fileStream = fs.createReadStream(scrapePath)
  fileStream.on('error', (fsErr) => {
    done(fsErr)
  })
  s3Params.Body = fileStream
  s3Params.Key = s3Path
  s3.upload(s3Params, (s3Err, response) => {
    if (s3Err) done(s3Err)
    fs.unlink(scrapePath, (err) => {
      done(err)
    })
  })
})
