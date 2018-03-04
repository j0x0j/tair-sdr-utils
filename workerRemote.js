const fs = require('fs')
const kue = require('kue')
const request = require('request')
const { checkLogLock } = require('./logUtils')
const jobs = kue.createQueue()
const log = fs.createWriteStream(__dirname + '/matches.log', { flags : 'w' })

// const DEJAVU_HOST = 'localhost'
const DEJAVU_HOST = 'dejavu.tair.network'
const BMP_HOST = 'bmp.tair.network'
// const DEJAVU_HOST = '192.168.1.124'
// const DEJAVU_HOST = 'localhost'

jobs.process('sample', 2, (job, done) => {
  console.log('New Sample Job:', job.data.uuid)
  const SAMPLE_PATH = __dirname + `/samples/sample_${job.data.uuid}.wav`
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
      data.confidence >= 200
    ) {
      // is a match, should do further processing
      const date = new Date(data.timestamp)
      // Log to local file before filtering
      log.write(`${job.data.stn};${data.confidence};${data.song_name};${job.data.uuid};${date.toISOString()}` + '\n')
      // Check if creative is locked
      // Send matched if properly parsed = not locked
      if (checkLogLock(job.data.stn, data.song_name, job.data.uuid)) {
        console.log('IS NOT LOCKED, SEND MATCH', job.data.uuid)
        const body = {
          station: job.data.stn,
          creative: data.song_name,
          sample: job.data.uuid,
          createdAt: date.toISOString(),
        }
        const options = {
          method: 'POST',
          uri: `https://${BMP_HOST}/log`,
          resolveWithFullResponse: true,
          json: true,
          body
        }
        request(options).then(() => done()).catch(err => done(err))
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

kue.app.listen(3000)
