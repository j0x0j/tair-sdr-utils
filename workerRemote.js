const fs = require('fs')
const uuidv4 = require('uuid/v4')
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
const ACCEPTED_CONFIDENCE = config.ACCEPTED_CONFIDENCE
const CONCURRENT_JOBS = config.CONCURRENT_JOBS
const S3_BUCKET = config.S3_BUCKET
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
    const dejavu_data = JSON.parse(body)
    if (dejavu_data && dejavu_data.confidence && dejavu_data.confidence >= ACCEPTED_CONFIDENCE) {
      // it's a match, add a match segment to the job queue
      let segment_data = {
        song_id: dejavu_data.song_id,
        song_name: dejavu_data.song_name,
        song_duration: dejavu_data.song_duration,
        offset_seconds: dejavu_data.offset_seconds,
        timestamp: job.data.timestamp,
        station: job.data.stn,
        market: job.data.market,
        uuid: uuidv4()
      }
      jobs.create('match-segment', segment_data).save();
      log.write(`${job.data.stn};${dejavu_data.confidence};${dejavu_data.song_name};${job.data.uuid};${job.data.timestamp}` + '\n')
    }
    fs.unlink(SAMPLE_PATH, (err) => {
      done(err)
    })
  })
})
