const fs = require('fs')
const uuidv4 = require('uuid/v4')
const kue = require('kue')
const wav = require('wav')
const dotenv = require('dotenv')
const { prettyLog } = require('./logUtils')
const jobs = kue.createQueue()
const redis = require('redis')
const redisClient = redis.createClient();

const config = dotenv.load().parsed
const CONCURRENT_JOBS = config.CONCURRENT_JOBS
// sample time is in milliseconds
const SAMPLE_TIME = parseInt(config.SAMPLE_TIME)
// this is the number of milliseconds of audio to include before and after a match
const MATCH_PADDING = 5000

let possibleMatches = {}
/*
  {
    <song_id>: {
      song_id: <song_id>,
      song_name: <song_name>,
      song_duration: <song_duration>,
      station: <station>,
      segments: [
        {
          uuid: <uuid>,
          offset_seconds: <offset_seconds>,
          timestamp: <timestamp>
        },
        ...
      ]
    },
    ...
  }
*/

jobs.process('match-segment', CONCURRENT_JOBS, (job, done) => {
  prettyLog('New Match Segment Job for: '+job.data.song_name)
  prettyLog(job.data)
  let timeAccountedFor = 0; // milliseconds
  let possibleMatch = possibleMatches[job.data.song_id];
  // missingTimeLimit is the limit for missing matched audio duration.
  // if we get a match for a song that is already missing too much matched time, it is not a match.
  // for example, we could just be hearing a clip of a song being used in an ad.
  let missingTimeLimit = SAMPLE_TIME/2

  // Don't add possible matches if there is already more missing time than allowed to verify a match
  if (possibleMatch || job.data.offset_seconds * 1000 < missingTimeLimit) {
    if (!possibleMatch) {
      possibleMatches[job.data.song_id] = {
        song_id: job.data.song_id,
        song_name: job.data.song_name,
        song_duration: job.data.song_duration,
        station: job.data.station,
        market: job.data.market,
        segments: []
      }
      possibleMatch = possibleMatches[job.data.song_id];
    }

    possibleMatch.segments.push({
      uuid: job.data.uuid,
      offset_seconds: job.data.offset_seconds,
      timestamp: job.data.timestamp
    })

    possibleMatch.segments.forEach((segment) => {
      if (job.data.offset_seconds * 1000 <= 0) {
        // this means the sample starts before the song starts. offset_seconds should be negative.
        timeAccountedFor += SAMPLE_TIME + (job.data.offset_seconds * 1000)
      } else {
        // this means the song ends before the sample ends or the sample is entirely in the song
        timeAccountedFor += Math.min(SAMPLE_TIME, ((job.data.song_duration - job.data.offset_seconds) * 1000))
      }
    })
    prettyLog('timeAccountedFor is of type: ' + (typeof timeAccountedFor))

    prettyLog('timeAccountedFor: ' + timeAccountedFor)

    // if the possible match identified by song_id has enough time accounted for it
    if (timeAccountedFor >= (job.data.song_duration * 1000) - missingTimeLimit) {
      let lastSegment = possibleMatch.segments[possibleMatch.segments.length - 1]
      let paddedStartTime = Math.round(lastSegment.timestamp - (lastSegment.offset_seconds * 1000) - MATCH_PADDING)
      let paddedEndTime = Math.round(paddedStartTime + (job.data.song_duration * 1000) + (MATCH_PADDING * 2))
      let uuid = uuidv4()

      prettyLog('paddedStartTime: ' + paddedStartTime)
      prettyLog('paddedEndTime: ' + paddedEndTime)
      prettyLog('duration: ' + (paddedEndTime - paddedStartTime))

      let ws = new wav.FileWriter(`./matches/match_${uuid}.wav`, {
        endianness: 'LE',
        channels: 1
      })

      redisClient.zrangebyscore('SIGNAL_CACHE', paddedStartTime, paddedEndTime, (err, chunkStrings) => {
        if(err) {
          prettyLog("Error running zrange for: " + possibleMatch.song_name)
          prettyLog(err)
        }
        chunkStrings.forEach((chunkString) => {
          ws.write(Buffer.from(chunkString, 'base64'))
        })
        ws.end()
        prettyLog(`Created local match file: ./matches/match_${uuid}.wav for: ` + possibleMatch.song_name)
        jobs.create('match', {
          song_id: possibleMatch.song_id,
          title: possibleMatch.song_name,
          station: possibleMatch.station,
          market: possibleMatch.market,
          timestamp: paddedStartTime,
          file_path: `./matches/match_${uuid}.wav`,
          uuid
        }).save()
        // clear possibleMatches
        possibleMatches = {}
      })
    }
  }
  done()
})
