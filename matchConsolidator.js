const uuidv4 = require('uuid/v4')
const kue = require('kue')
const wav = require('wav')
const dotenv = require('dotenv')
const { prettyLog } = require('./logUtils')
const jobs = kue.createQueue()
const redis = require('redis')
const redisClient = redis.createClient()

const config = dotenv.load().parsed
// const CONCURRENT_JOBS = +config.CONCURRENT_JOBS
// sample time is in milliseconds
const SAMPLE_TIME = +config.SAMPLE_TIME
// this is the number of milliseconds of audio to include before and after a match
const MATCH_PADDING = 5000
const SAMPLE_DELAY = 2500

let possibleMatches = {}
/*
possibleMatches = {
    <song_id>: {
      <song_start_time_string> : {
        song_id: <song_id>,
        song_name: <song_name>,
        song_start_time: <millisecond song_start_time>
        song_duration: <song_duration>,
        station: <station>,
        segments: [
          {
            uuid: <uuid>,
            offset_seconds: <offset_seconds>,
            timestamp: <millisecond timestamp>
          },
          ...
        ]
      },
      ...
    },
    ...
  }
*/

function checkForExistingMatch (songId, songStartTime) {
  if (possibleMatches[songId]) {
    for (var songStartTimeString in possibleMatches[songId]) {
      let existingStartTime = parseInt(songStartTimeString)
      if (Math.abs(existingStartTime - songStartTime) < SAMPLE_TIME) {
        return possibleMatches[songId][songStartTimeString]
      }
    }
  }
  return null
}

jobs.process('match-segment', 1, (job, done) => {
  prettyLog('New Match Segment Job for:', job.data.song_name)
  prettyLog(job.data)
  let songStartTime = Math.round(job.data.timestamp - (job.data.offset_seconds * 1000))
  let songStartTimeString = songStartTime.toString()
  let possibleMatch = checkForExistingMatch(job.data.song_id, songStartTime)
  // missingTimeLimit is the limit for missing matched audio duration.
  // if we get a match for a song that is already missing too much matched time, it is not a match.
  // for example, we could just be hearing a clip of a song being used in an ad.
  let missingTimeLimit = SAMPLE_TIME
  let segmentCount = 0

  // Don't add possible matches if there is already more missing time than allowed to verify a match
  if (possibleMatch || job.data.offset_seconds * 1000 < missingTimeLimit) {
    if (!possibleMatch) {
      if (!possibleMatches[job.data.song_id]) {
        possibleMatches[job.data.song_id] = {}
      }
      possibleMatches[job.data.song_id][songStartTimeString] = {
        song_id: job.data.song_id,
        song_name: job.data.song_name,
        song_start_time: songStartTime,
        song_duration: job.data.song_duration,
        station: job.data.station,
        market: job.data.market,
        segments: []
      }
      possibleMatch = possibleMatches[job.data.song_id][songStartTimeString]
    }

    possibleMatch.segments.push({
      uuid: job.data.uuid,
      offset_seconds: job.data.offset_seconds,
      timestamp: job.data.timestamp
    })
    segmentCount = possibleMatch.segments.length
    prettyLog('Segment count is: ' + segmentCount)
    // after 2 sample times,
    setTimeout(() => {
      let timeAccountedFor = 0 // milliseconds
      prettyLog('After the timeout:')
      // check that no new segments have come in for this possibleMatch
      if (possibleMatch.segments.length === segmentCount) {
        prettyLog('No more segments have been added')
        // timeAccountedFor calculation needs to take into account overlapping samples
        const songDuration = job.data.song_duration * 1000
        let verifiedStartTime;
        let verifiedEndTime;

        // check if we have enough time accounted for
        possibleMatch.segments.forEach((segment) => {
          const offset = segment.offset_seconds * 1000
           // this is for when the sample starts before the song starts:
          let startTime = segment.timestamp - Math.min(offset, 0)
           // this is for when the song ends before the sample ends:
          let endTime = segment.timestamp + Math.min(SAMPLE_TIME, (songDuration - offset))
          if (!verifiedStartTime) {
            verifiedStartTime = startTime
            verifiedEndTime = endTime
          } else {
            const validStart = startTime > verifiedStartTime && startTime < verifiedEndTime
            const validEnd = endTime > verifiedEndTime
            if (validStart && validEnd) {
              verifiedEndTime = endTime
            } else {
              prettyLog('found a confidence discontinuity. This is not a continuous match')
              // Not a continuous match
              timeAccountedFor = 0
              break
            }
          }
          timeAccountedFor = verifiedEndTime - verifiedStartTime
        })

        prettyLog('time accounted for is: ' + timeAccountedFor)

        // if the possible match identified by song_id has enough time accounted for it
        if (timeAccountedFor >= (job.data.song_duration * 1000) - missingTimeLimit) {
          let lastSegment = possibleMatch.segments[possibleMatch.segments.length - 1]
          let paddedStartTime = Math.round(lastSegment.timestamp - (lastSegment.offset_seconds * 1000) - MATCH_PADDING)
          let paddedEndTime = Math.round(paddedStartTime + (job.data.song_duration * 1000) + (MATCH_PADDING * 2))
          let uuid = uuidv4()

          prettyLog('paddedStartTime: ' + paddedStartTime)
          prettyLog('paddedEndTime: ' + paddedEndTime)
          prettyLog('duration: ' + (paddedEndTime - paddedStartTime))

          redisClient.zrangebyscore('SIGNAL_CACHE', paddedStartTime, paddedEndTime, (err, chunkStrings) => {
            if (err) {
              prettyLog('Error running zrange for:', possibleMatch.song_name)
              prettyLog(err)
            }
            const ws = new wav.FileWriter(`./matches/match_${uuid}.wav`, {
              endianness: 'LE',
              channels: 1
            })
            chunkStrings.forEach((chunkString) => {
              ws.write(Buffer.from(chunkString, 'base64'))
            })
            ws.on('error', (writeError) => {
              delete possibleMatches[job.data.song_id][songStartTimeString]
            })
            ws.on('end', () => {
              prettyLog(`Created local match file: ./matches/match_${uuid}.wav for:`, possibleMatch.song_name)
              jobs.create('match', {
                song_id: possibleMatch.song_id,
                song_name: possibleMatch.song_name,
                station: possibleMatch.station,
                market: possibleMatch.market,
                timestamp: paddedStartTime,
                file_path: `./matches/match_${uuid}.wav`,
                uuid
              }).save()
              // clear possibleMatches
              delete possibleMatches[job.data.song_id][songStartTimeString]
            })
            ws.end()
          })
        } else {
          delete possibleMatches[job.data.song_id][songStartTimeString]
        }
      }
    }, SAMPLE_TIME * 2)
  }
  done()
})
