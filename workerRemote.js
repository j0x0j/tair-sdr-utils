const fs = require('fs')
const uuidv4 = require('uuid/v4')
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
    const dejavuJson = JSON.parse(body)
    const possibleMatches =  array();
    possibleMatches.push(dejavuJson);
    if (dejavuJson['fallback_matches']) {
      possibleMatches.concat(dejavuJson['fallback_matches'])
    }
    possibleMatches.forEach((dejavuData) => {
      prettyLog('dejavu confidence is:', dejavuData.confidence)
      if (dejavuData && dejavuData.confidence && dejavuData.confidence >= ACCEPTED_CONFIDENCE) {
        prettyLog('dejavu confidence passed threshold of:', ACCEPTED_CONFIDENCE)
        // it's a match, add a match segment to the job queue
        let segmentData = {
          song_id: dejavuData.song_id,
          song_name: dejavuData.song_name,
          song_duration: dejavuData.song_duration,
          offset_seconds: dejavuData.offset_seconds,
          timestamp: job.data.timestamp,
          station: job.data.station,
          market: job.data.market,
          uuid: uuidv4()
        }
        jobs.create('match-segment', segmentData).save()
        log.write(`${job.data.stn};${dejavuData.confidence};${dejavuData.song_name};${job.data.uuid};${job.data.timestamp}` + '\n')
      }
    })
    fs.unlink(SAMPLE_PATH, (err) => {
      done(err)
    })
  })
})
