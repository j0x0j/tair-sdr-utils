const uuidv4 = require('uuid/v4')
const kue = require('kue')
const wav = require('wav')
const dotenv = require('dotenv')
const { prettyLog } = require('./logUtils')
const jobs = kue.createQueue()
const redisClient = jobs.client

const config = dotenv.load().parsed
// const CONCURRENT_JOBS = +config.CONCURRENT_JOBS
// sample time is in milliseconds
const SAMPLE_TIME = +config.SAMPLE_TIME
// this is the number of milliseconds of audio to include before and after a match
const MATCH_PADDING = 5000
const ACCEPTED_CONFIDENCE = +config.ACCEPTED_CONFIDENCE

let possibleMatches = {}
/*
possibleMatches = {
  <market>: {
    <station>: {
      <song_id>: {
        <song_start_time_string> : {
          song_id: <song_id>,
          song_name: <song_name>,
          song_start_time: <millisecond song_start_time>
          song_duration: <song_duration>,
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
    },
    ...
  },
  ...
}
*/

function checkForExistingMatch (market, station, songId, songStartTime) {
  if (possibleMatches[market] && possibleMatches[market][station] && possibleMatches[market][station][songId]) {
    for (var songStartTimeString in possibleMatches[market][station][songId]) {
      const songDuration = possibleMatches[market][station][songId][songStartTimeString].song_duration
      let existingStartTime = parseInt(songStartTimeString)
      if (Math.abs(existingStartTime - songStartTime) < songDuration * 1000) {
        return possibleMatches[market][station][songId][songStartTimeString]
      }
    }
  }
  return null
}

jobs.process('match-segment', 1, (job, done) => {
  prettyLog('New Match Segment Job for:', job.data.song_name)
  prettyLog(job.data)
  let completed = false
  let songStartTime = Math.round(job.data.timestamp - (job.data.offset_seconds * 1000))
  let songStartTimeString = songStartTime.toString()
  let possibleMatch = checkForExistingMatch(job.data.market, job.data.station, job.data.song_id, songStartTime)
  let spotDuration = job.data.song_duration * 1000
  // missingTimeLimit is the limit for missing matched audio duration.
  // if we get a match for a song that is already missing too much matched time, it is not a match.
  // for example, we could just be hearing a clip of a song being used in an ad.
  // matches must have less than SAMPLE_TIME or 10% missing, whichever is greater.
  let missingTimeLimit = Math.max(SAMPLE_TIME, job.data.song_duration * 100) // 100 bc it's 1000/10 (10% of duration*1000)
  let segmentCount = 0

  // Don't add possible matches if there is already more missing time than allowed to verify a match
  console.log('Possible Match:', possibleMatch)
  if (possibleMatch || job.data.offset_seconds * 1000 < missingTimeLimit) {
    if (!possibleMatch) {
      if (!possibleMatches[job.data.market]) {
        possibleMatches[job.data.market] = {}
      }
      if (!possibleMatches[job.data.market][job.data.station]) {
        possibleMatches[job.data.market][job.data.station] = {}
      }
      if (!possibleMatches[job.data.market][job.data.station][job.data.song_id]) {
        possibleMatches[job.data.market][job.data.station][job.data.song_id] = {}
      }
      possibleMatch = possibleMatches[job.data.market][job.data.station][job.data.song_id][songStartTimeString] = {
        song_id: job.data.song_id,
        song_name: job.data.song_name,
        song_start_time: songStartTime,
        song_duration: job.data.song_duration,
        station: job.data.station,
        market: job.data.market,
        creative: job.data.creative,
        segments: []
      }
    }
    // only push the segment if its confidence is higher than any existing segment with the "same" timestamp (within a second)
    // this way, after the ad time passes, we will have the segments with the highest confidence for the given timestamp
    const segment = {
      uuid: job.data.uuid,
      offset_seconds: job.data.offset_seconds,
      timestamp: job.data.timestamp,
      confidence: job.data.confidence
    }
    let found = false
    for (let seg of possibleMatch.segments) {
      // if a seg matches out timestamp (within one second)
      if (Math.abs(seg.timestamp - segment.timestamp) < 1000) {
        found = true
        if (segment.confidence > seg.confidence) {
          Object.assign(seg, segment)
        }
        break
      }
    }
    if (!found) {
      // Is the segment the first one or is the offset_seconds for the segment chronological to
      // the last segment, should be greater than the last offset plus SAMPLE_TIME in seconds
      const lastSegment = possibleMatch.segments[possibleMatch.segments.length - 1]
      const sampleTimeSeconds = SAMPLE_TIME / 1000
      // Millisecond offsets can affect the segment.offset_seconds comparison, so we need to
      // allow for some fuzzyness here. We'll add 80% of the sampleTimeSeconds to the lastSegment offset
      if (!lastSegment || segment.offset_seconds >= lastSegment.offset_seconds + sampleTimeSeconds * 0.8) {
        possibleMatch.segments.push(segment)
      }
    }
    segmentCount = possibleMatch.segments.length
    prettyLog('Segment count is: ' + segmentCount + ' for ' + job.data.song_name)
    // after 2 sample times,
    setTimeout(() => {
      let now = job.data.isReplay ? (job.data.timestamp - SAMPLE_TIME * 1000) : Date.now()
      let timeAccountedFor = 0 // milliseconds
      let enoughTimeHasPassed = now >= (songStartTime + spotDuration + MATCH_PADDING)
      prettyLog('After the timeout: ' + job.data.song_name)
      // check that no new segments have come in for this possibleMatch
      // if the ad time since song_start_time has passed along with the ending MATCH_PADDING
      if (
        (possibleMatch.segments.length === segmentCount || enoughTimeHasPassed) &&
        !completed &&
        // Verify that the segment tree object for this intance of song_id in
        // market / station has NOT been deleted so as to not create multiple match
        // jobs for a song_id that was just recognized the segment before
        possibleMatches[job.data.market][job.data.station][job.data.song_id]
      ) {
        prettyLog('No more segments have been added')

        // verifiedStartTime & verifiedEndTime will define the range of time accounted for in this spot
        let verifiedStartTime
        let verifiedEndTime

        // ASSUMPTION: the segments are in chronological order.
        // we will attempt to create an uninterrupted verified time range for the duration of the spot,
        // one segment at a time to see how much of the spot we have accounted for
        possibleMatch.segments.forEach((segment) => {
          // segmentOffset (ms) is the start time of this segment minus the start time of the entire spot
          // it is negative when the segment begins before the spot, and positive when it begins after the spot begins
          // it is zero if both the segment and the spot start at the same time
          const segmentOffset = segment.offset_seconds * 1000

          // spotStartTime (ms) is when the entire spot begins
          const spotStartTime = segment.timestamp - segmentOffset

          // spotEndTime (ms) is when the entire spot ends
          const spotEndTime = spotStartTime + spotDuration

          // segmentStartTime (ms) is the time when the segment begins to contain part of the spot
          let segmentStartTime = segment.timestamp

          // if the segment starts before the spot, the beginning of the segment will not contain spot audio
          // this means the segmentStartTime will be greater than segment.timestamp
          if (segmentOffset < 0) {
            segmentStartTime -= segmentOffset
          }

          // segmentEndTime (ms) is the time when the segment stops containing part of the spot
          let segmentEndTime = segment.timestamp + SAMPLE_TIME

          // if the segment ends before the spot ends, the end of the segment will not contain spot audio
          // this means the segmentEndTime will be before the segment audio ends
          if (spotEndTime < segmentEndTime) {
            segmentEndTime = spotEndTime
          }

          if (!verifiedStartTime) {
            // if verifiedStartTime has not been defined, that means this is the first segment for this spot.
            // we can just set the segment's start and end times as the verified start and end times
            verifiedStartTime = segmentStartTime
            verifiedEndTime = segmentEndTime
          } else {
            // since verifiedStartTime is defined,
            // this segment must start after verifiedStartTime and before segmentEndTime
            const validStart = segmentStartTime > verifiedStartTime && segmentStartTime < spotEndTime
            // and this segment must end after verifiedEndTime
            const validEnd = segmentEndTime > verifiedEndTime

            if (validStart && validEnd) {
              // if this segment is valid, we update the verifiedEndTime to be this segment's segmentEndTime
              verifiedEndTime = segmentEndTime
            } else {
              prettyLog('found a confidence discontinuity. This is not a continuous match')
              // Not a continuous match
              timeAccountedFor = 0
              return
            }
          }
          // we add this segment's verified spot time to the timeAccountedFor
          timeAccountedFor += (segmentEndTime - segmentStartTime)
        })

        prettyLog('time accounted for is: ' + timeAccountedFor)

        // if the possible match identified by song_id has enough time accounted for it
        // there is also a conditional check for the average confidence of segments being >= ACCEPTED_CONFIDENCE
        let averageConfidence = 0
        for (let seg of possibleMatch.segments) {
          averageConfidence += seg.confidence
        }
        averageConfidence = averageConfidence / possibleMatch.segments.length
        if (timeAccountedFor >= (spotDuration - missingTimeLimit) && averageConfidence >= ACCEPTED_CONFIDENCE) {
          let paddedStartTime = Math.round(possibleMatch.song_start_time - MATCH_PADDING)
          let paddedEndTime = Math.round(possibleMatch.song_start_time + spotDuration + MATCH_PADDING)
          let uuid = uuidv4()

          prettyLog('paddedStartTime: ' + paddedStartTime)
          prettyLog('paddedEndTime: ' + paddedEndTime)
          prettyLog('now: ' + now)
          prettyLog('duration: ' + (paddedEndTime - paddedStartTime))
          prettyLog('averageConfidence: ' + averageConfidence)

          redisClient.zrangebyscore(`SIGNAL_CACHE_${possibleMatch.station.replace(/ /g, '')}`, paddedStartTime, paddedEndTime, (err, chunkStrings) => {
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
              delete possibleMatches[job.data.market][job.data.station][job.data.song_id]
              completed = true
            })
            ws.on('end', () => {
              prettyLog(`Created local match file: ./matches/match_${uuid}.wav for:`, possibleMatch.song_name)
              jobs.create('match', {
                song_id: possibleMatch.song_id,
                creative: possibleMatch.creative,
                song_name: possibleMatch.song_name,
                station: possibleMatch.station,
                market: possibleMatch.market,
                timestamp: paddedStartTime,
                file_path: `./matches/match_${uuid}.wav`,
                uuid
              }).save()
              // clear possibleMatches
              delete possibleMatches[job.data.market][job.data.station][job.data.song_id]
              completed = true
            })
            ws.end()
          })
        } else {
          delete possibleMatches[job.data.market][job.data.station][job.data.song_id]
          completed = true
        }
      }
    }, SAMPLE_TIME * 2 + MATCH_PADDING)
  }
  done()
})

jobs.on('error', err => {
  console.log('KUE ERROR at:', new Date())
  console.error(err)
})
