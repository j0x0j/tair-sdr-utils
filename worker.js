const fs = require('fs')
const kue = require('kue')
const request = require('request')
const path = require('path')
const jobs = kue.createQueue()
const log = fs.createWriteStream(path.join(__dirname, '/matches.log'), { flags: 'w' })

jobs.process('sample', 1, (job, done) => {
  console.log('New Sample Job:', job.data.uuid)
  request.post('http://192.1.168.124:8080/recognize?uuid=' + job.data.uuid, (err, res, body) => {
    if (err) throw err
    const data = JSON.parse(body)
    console.log(data)
    if (
      data.confidence &&
      data.confidence >= 110
    ) {
      // is a match, should do further processing
      log.write(`${job.data.stn};${data.confidence};${data.song_name};${job.data.uuid};${new Date().toISOString()}` + '\n')
    } else {
      console.log('Didn\'t match')
      // fs.unlinkSync('/Users/jo/projects/tair/sdr/samples/sample_' + job.data.uuid + '.wav')
    }
    done()
  })
})

kue.app.listen(3000)
