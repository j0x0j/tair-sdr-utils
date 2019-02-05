const cp = require('child_process')
const uuidv4 = require('uuid/v4')
const wav = require('wav')
const kue = require('kue')

const STATION = process.env.band || process.argv[2]
const DEVICE = process.env.device || process.argv[3]
const SCRAPE_DURATION = 1000 * 60 * 60
// Max bytes to write in order to create a sample file 44100 is our sample
// rate at 8 bits, we use 16 bit samples so we multiply by 2
const MAX_BYTES_PER_SAMPLE = (SCRAPE_DURATION / 1000 * 44100) * 2

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

// Create queue
const jobs = kue.createQueue()

// Initial UUID
let uuid = uuidv4()
// Writer options
const opts = {
  endianness: 'LE',
  channels: 1
}

let ws = new wav.FileWriter(
  `./scrapes/scrape_${uuid}.wav`,
  opts
)

let currentBytes = 0

child1.stdout.on('data', chunk => {
  currentBytes += chunk.length
  child1.stdout.pause()
  if (currentBytes >= MAX_BYTES_PER_SAMPLE) {
    currentBytes = 0
    const ts = new Date()
    ts.setSeconds(ts.getSeconds() - SCRAPE_DURATION)
    jobs.create('scrape', {
      stn: STATION,
      timestamp: ts.toISOString(),
      uuid
    }).removeOnComplete(true).save()
    uuid = uuidv4()
    ws.end()
    ws = new wav.FileWriter(
      `./scrapes/scrape_${uuid}.wav`,
      opts
    )
  }
  ws.write(chunk)
  child1.stdout.resume()
})

child1.stderr.pipe(process.stdout)

process.on('SIGINT', function () {
  child1.kill('SIGINT')
  process.exit(0)
})
