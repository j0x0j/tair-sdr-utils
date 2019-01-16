const fs = require('fs')
const kue = require('kue')
const path = require('path')
const es = require('event-stream')
const dotenv = require('dotenv')

const config = dotenv.load().parsed
const SAMPLE_TIME = +config.SAMPLE_TIME

const jobs = kue.createQueue()
// Start Queue Server
kue.app.listen(3000)

const stream = fs.createReadStream(path.join(__dirname, './logs/matches.log'))
  .pipe(es.split())
  .pipe(es.mapSync((line, cb) => {
    console.log('Reading Line', Date.now())
    stream.pause()
    const record = line.split(';')
    const segmentData = {
      station: record[0],
      confidence: +record[1],
      song_id: record[2],
      song_name: record[3],
      creative: record[4],
      uuid: record[5],
      timestamp: +record[6],
      song_duration: +record[7],
      offset_seconds: +record[8],
      market: 'NYC',
      isReplay: true
    }
    setTimeout(function () {
      // Resume stream to emit next line
      stream.resume()
      jobs.create('match-segment', segmentData).removeOnComplete(true).save()
      console.log('song', segmentData.song_name)
    }, SAMPLE_TIME)
  }))
  .on('error', err => {
    console.log('Error while reading file.', err)
  })
  .on('end', () => {
    console.log('Read entire file.')
  })
