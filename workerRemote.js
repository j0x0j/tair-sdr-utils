const fs = require('fs')
const kue = require('kue')
const dotenv = require('dotenv')
const request = require('request-promise')
const path = require('path')
const { checkLogLock, prettyLog } = require('./logUtils')
const jobs = kue.createQueue()
const ProtocolInterface = require('./client/Interface')
const validator = new ProtocolInterface()
const log = fs.createWriteStream(path.join(__dirname, '/matches.log'), { flags: 'w' })

const matches = {}
const pendingReveals = []

const config = dotenv.load().parsed
const ACCEPTED_CONFIDENCE = +config.ACCEPTED_CONFIDENCE

const DEJAVU_HOST = 'dejavu.tair.network'
const BMP_HOST = 'bmp.tair.network'

jobs.process('sample', 1, (job, done) => {
  console.log('New Sample Job:', job.data.uuid)
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
    const data = JSON.parse(body)
    console.log(data)
    if (
      data &&
      data.confidence &&
      data.confidence >= ACCEPTED_CONFIDENCE
    ) {
      // is a match, should do further processing
      // Log to local file before filtering
      log.write(`${job.data.stn};${data.confidence};${data.song_name};${job.data.uuid};${job.data.timestamp}` + '\n')
      // Check if creative is locked
      // Send matched if properly parsed = not locked
      if (checkLogLock(job.data.stn, data.song_name, job.data.uuid, job.data.timestamp)) {
        prettyLog('IS NOT LOCKED, SEND MATCH', job.data.uuid)
        const body = {
          station: job.data.stn,
          creative: data.song_name,
          sample: job.data.uuid,
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
            // Should check if match belongs to an active Round
            // data.song_id
            const roundId = matches[`match${data.song_id}`]
            if (roundId) {
              // Commit matchId
              const round = +roundId
              const match = +data.song_id
              // Reveal on new block
              pendingReveals.push({ round, match })
              // delete map
              delete matches[`match${data.song_id}`]
              prettyLog('COMMIT MATCH:', (round + ' ' + match))
              return validator.commitMatch(round, match)
            } else {
              done()
            }
          })
          .then((receipt) => {
            if (receipt && receipt.status === '0x01') {
              prettyLog('COMMIT MATCH RECEIPT', receipt.transactionHash)
              done()
            } else {
              done(receipt)
            }
          })
          .catch(bmpErr => {
            console.log('BMP ERROR:', bmpErr)
            done(bmpErr)
          })
      } else {
        done()
      }
    } else {
      console.log('Didn\'t match')
      fs.unlink(SAMPLE_PATH, (err) => {
        done(err)
      })
    }
  })
})

// Ethereum Contract Client
validator.events.on('data', (log) => {
  // Check block height before triage
  if (validator.blockNumber > log.blockNumber) {
    // its an old event
    return
  }
  prettyLog('EVENT LOG:', log.event)
  prettyLog('EVENT LOG VALUES:', log.returnValues)
  if (log.event === 'RoundCreation') {
    // Should set round data
    matches[`match${log.returnValues.sampleId}`] =
      log.returnValues.roundId
  }
  if (log.event === 'RoundValidated') {
    validator.checkWinner(log.returnValues.winner.toLowerCase())
  }
  if (log.event === 'WillCallOraclize') {
    // Only admin should call this
    // const random = Math.floor(Math.random() * 100) + 1
    // prettyLog('RANDOM:', random)
    // validator.finalizeRound(log.returnValues.roundId, random)
    //   .then(receipt => {
    //     prettyLog('FINALIZE ROUND RECEIPT', receipt.transactionHash)
    //   })
    //   .catch(err => {
    //     prettyLog('FINALIZE ROUND TXN ERROR', err)
    //   })
  }
})

validator.events.on('error', (err) => {
  console.log('ERROR:', err)
})

// Maintain some blockchain state
validator.pollForNewBlock(1000 * 30)
validator.on('newBlock', (data) => {
  // should check for pending reveal
  prettyLog('block:', data)
  // prettyLog(`Polling for new block in 15 seconds`)

  const reveal = pendingReveals.pop()
  if (!reveal) return
  prettyLog('REVEAL MATCH:', (reveal.round + ' ' + reveal.match))
  validator.revealMatch(reveal.round, reveal.match)
    .then(receipt => {
      prettyLog('REVEAL MATCH RECEIPT:', receipt.transactionHash)
    })
    .catch(err => {
      prettyLog('REVEAL MATCH TXN ERROR', err)
    })
})

kue.app.listen(3000)
