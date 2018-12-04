const fs = require('fs')
const uuidv4 = require('uuid/v4')
const kue = require('kue')
const dotenv = require('dotenv')
const request = require('request')
const path = require('path')
const { prettyLog } = require('./logUtils')
const jobs = kue.createQueue()
const log = fs.createWriteStream(path.join(__dirname, '/matches.log'), { flags: 'w' })

const config = dotenv.load().parsed
const CONCURRENT_JOBS = +config.CONCURRENT_JOBS
const DEJAVU_HOST = 'dejavu.tair.network'
let NO_CONNECTION = false

const cleanUpSampleFile = (samplePath, done, err) => {
  fs.unlink(samplePath, (err) => { done(err) })
}

const heartbeat = (timeout = 5000) => {
  request({
    method: 'GET',
    uri: `http://${DEJAVU_HOST}/health`,
    json: true,
    timeout
  }, (err, res, body) => {
    if (err) {
      NO_CONNECTION = true
    }
    if (body && body.status === 'OK') {
      NO_CONNECTION = false
    }
  })
}

jobs.process('sample', CONCURRENT_JOBS, (job, done) => {
  prettyLog('New Sample Job:', job.data.uuid)
  const SAMPLE_PATH = path.join(__dirname, `/samples/sample_${job.data.uuid}.wav`)
  if (NO_CONNECTION) {
    return cleanUpSampleFile(SAMPLE_PATH, done, new Error('Remote service not available'))
  }
  const sampleReadStream = fs.createReadStream(SAMPLE_PATH)
  sampleReadStream.on('error', err => { done(err) })
  const options = {
    method: 'POST',
    uri: `http://${DEJAVU_HOST}/sample`,
    formData: {
      file: sampleReadStream
    }
  }
  request(options, (err, res, body) => {
    if (err) {
      return cleanUpSampleFile(SAMPLE_PATH, done, err)
    }
    try {
      var dejavuJson = JSON.parse(body)
    } catch (jsonParseError) {
      return cleanUpSampleFile(SAMPLE_PATH, done, jsonParseError)
    }
    const possibleMatches = []
    possibleMatches.push(dejavuJson)
    if (dejavuJson && dejavuJson['fallback_matches']) {
      possibleMatches.concat(dejavuJson['fallback_matches'])
    }
    possibleMatches.forEach((dejavuData) => {
      prettyLog('dejavu confidence is:', dejavuData && dejavuData.confidence)
      if (dejavuData && dejavuData.confidence) {
        let segmentData = {
          song_id: dejavuData.song_id,
          creative: dejavuData.creative_id,
          song_name: dejavuData.song_name,
          song_duration: dejavuData.song_duration,
          offset_seconds: dejavuData.offset_seconds,
          timestamp: job.data.timestamp,
          station: job.data.station,
          market: job.data.market,
          confidence: dejavuData.confidence,
          uuid: uuidv4()
        }
        jobs.create('match-segment', segmentData).removeOnComplete(true).save()
        log.write(`${job.data.station};${dejavuData.confidence};${dejavuData.song_name};${job.data.uuid};${job.data.timestamp}` + '\n')
      }
    })
    cleanUpSampleFile(SAMPLE_PATH, done)
  })
})

jobs.on('error', err => {
  console.log('KUE ERROR in worker-remote at:', new Date())
  console.error(err)
  // This should restart the process
  process.exit(1)
})

process.on('uncaughtException', err => {
  console.log('uncaughtException in worker-remote at:', new Date())
  console.error(err)
  process.exit(1)
})

// Start Heartbeat
setInterval(heartbeat, 5000)
