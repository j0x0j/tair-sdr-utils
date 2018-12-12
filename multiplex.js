const cp = require('child_process')
const uuidv4 = require('uuid/v4')
const wav = require('wav')
const kue = require('kue')
const jobs = kue.createQueue()
const dotenv = require('dotenv')
const redisClient = jobs.client

const config = dotenv.load().parsed
const MARKET = config.MARKET
const SAMPLE_TIME = +config.SAMPLE_TIME
// Max bytes to write in order to create a sample file 44100 is our sample
// rate at 8 bits, we use 16 bit samples so we multiply by 2
const MAX_BYTES_PER_SAMPLE = (SAMPLE_TIME / 1000 * 44100) * 2
const STATION = process.env.band || process.argv[2]
const DEVICE = process.env.device || process.argv[3]

if (!STATION || !DEVICE) {
  throw new Error('Needs a station and device index')
}

let program = ''
let args
if (process.env.NODE_ENV && process.env.NODE_ENV === 'test') {
  program = 'node'
  args = [
    './throttler', process.env.TEST_FILE_PATH
  ]
} else {
  program = 'rtl_fm'
  args = [
    '-f', STATION,
    '-d', DEVICE,
    '-M', 'fm',
    '-s', '170k',
    '-A', 'std',
    '-l', '0',
    '-g', '20',
    '-E', 'deemp',
    '-r', '44.1k'
  ]
}

const child1 = cp.spawn(program, args)

// Initial UUID
let uuid = uuidv4()
// Writer options
const opts = {
  endianness: 'LE',
  channels: 1
}

const writeStreamErrorHandler = (writeError) => {
  console.log('Write Stream Error', writeError.message, new Date())
}

let ws = new wav.FileWriter(`./samples/sample_${uuid}.wav`, opts)
ws.on('error', writeStreamErrorHandler)

let currentBytes = 0

child1.stdout.on('data', chunk => {
  const now = Date.now()
  // Pause stream to manage backpressure manually]
  child1.stdout.pause()
  // Define the recurring file stream
  // Get the current timer elapsed time
  currentBytes += chunk.length
  // if (time >= SAMPLE_TIME) {
  if (currentBytes >= MAX_BYTES_PER_SAMPLE) {
    currentBytes = 0
    // Should only create a job after write stream ends
    // need the previous identifier to create the job
    // on async write stream end
    const prevuuid = uuid
    ws.on('end', () => {
      // Should enqueue a new job with the current timestamp
      jobs.create('sample', {
        title: `${STATION} - Sample ${prevuuid}`,
        station: STATION,
        market: MARKET,
        timestamp: now - SAMPLE_TIME,
        uuid: prevuuid
      }).removeOnComplete(true).save()
      // Only write after previous stream has ended
      ws.write(chunk)
      // Resume stream manually
      child1.stdout.resume()
    })
    // Close the current stream
    ws.end()
    // Generate a new sample id
    uuid = uuidv4()
    // Create new sample file
    ws = new wav.FileWriter(`./samples/sample_${uuid}.wav`, opts)
    ws.on('error', writeStreamErrorHandler)
  } else {
    ws.write(chunk)
    // Resume stream manually
    child1.stdout.resume()
  }
  // add chunk to redis sorted set: SIGNAL_CACHE for Date.now()
  // This timestamp won't match the ffempeg timestamp exactly but will be close enough for our needs.
  redisClient.zadd(`SIGNAL_CACHE_${STATION.replace(/ /g, '')}`, 'NX', Date.now(), chunk.toString('base64'))
})

// To disable rtl_fm logs
child1.stderr.pipe(process.stderr)

// Error handling
jobs.on('error', err => {
  console.log('KUE ERROR at:', new Date())
  console.error(err)
  child1.kill('SIGINT')
})

process.on('SIGINT', function () {
  console.log('SIGINT at:', new Date())
  child1.kill('SIGINT')
  process.exit(1)
})

process.on('uncaughtException', err => {
  console.log('uncaughtException in multiplex at:', new Date())
  console.log('Station: %s, Device: %s', STATION, DEVICE)
  console.error(err)
  child1.kill('SIGINT')
  process.exit(1)
})
