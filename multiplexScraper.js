const fs = require('fs')
const cp = require('child_process')
const uuidv4 = require('uuid/v4')
const wav = require('wav')
const kue = require('kue')
const simpleTimer = require('node-timers/simple')

const STATION = process.env.band || process.argv[2]
const DEVICE = process.env.device || process.argv[3]
const SCRAPE_DURATION = 1000 * 60 * 60;

if (!STATION || !DEVICE) {
  throw new Error('Needs a station and device index')
}

const child1 = cp.spawn('rtl_fm', [
  '-f', STATION,
  '-d', DEVICE,
  '-M', 'fm',
  '-s', '170k',
  '-A', 'std',
  '-l', '0',
  '-g', '20',
  '-E', 'deemp',
  '-r', '44.1k'
])

const child2 = cp.spawn('ffmpeg', [
  '-f', 's16le',
  '-ac', '1',
  '-i', '-',
  '-acodec', 'pcm_s16le',
  '-f', 'wav',
  '-'
])

const simple = simpleTimer({ pollInterval: 100 })

// Create queue
const jobs = kue.createQueue()

// Initial UUID
let uuid = uuidv4()
// Writer options
const opts = {
  endianness: 'LE',
  channels: 1,
}

let ws = new wav.FileWriter(
  `./scrapes/scrape_${uuid}.wav`,
  opts
)

simple.start()

child1.stdout.on('data', chunk => {
  child2.stdin.write(chunk)
})

child2.stdout.on('data', chunk => {
  let time = simple.time()
  if (time >= SCRAPE_DURATION) {
    const ts = new Date()
    ts.setSeconds(ts.getSeconds() - SCRAPE_DURATION)
    jobs.create('scrape', {
      stn: STATION,
      timestamp: ts.toISOString(),
      uuid
    }).save()
    uuid = uuidv4()
    simple.reset().start()
    ws.end()
    ws = new wav.FileWriter(
      `./scrapes/scrape_${uuid}.wav`,
      opts
    )
  }
  ws.write(chunk)
})

child1.stderr.pipe(process.stdout)
child2.stderr.pipe(process.stdout)

process.on('SIGINT', function () {
  process.kill(child1.pid, 'SIGKILL')
  process.kill(child2.pid, 'SIGKILL')
  process.exit(0)
})
