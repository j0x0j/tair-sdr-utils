const cp = require('child_process')
const kue = require('kue')
const fs = require('fs')

// The duration of a segment (in milliseconds)
const STATION = '104.7M'

const child = cp.spawn('ffmpeg', [
  '-i', '/Users/jo/Desktop/scrape_104.7M_2018-06-09.wav',
  '-f', 'segment',
  '-segment_time', '5',
  '-c', 'copy',
  './samples/sample_%03d.wav'
])

// Create queue
const jobs = kue.createQueue()

child.stdout.on('end', chunk => {
  fs.readdir('./samples', (err, files) => {
    if (err) console.log(err)
    files.forEach(file => {
      jobs.create('sample', {
        title: `${STATION} - Sample ${file}`,
        uuid: file.replace('.wav', '').split('_')[1]
      }).save()
    })
  })
})

// To disable rtl_fm logs
child.stderr.pipe(process.stderr)
child.stdout.pipe(process.stdout)

// pm2 start app.js --kill-timeout 3000

process.on('SIGINT', function () {
  process.kill(child.pid, 'SIGKILL')
  process.exit(0)
})
