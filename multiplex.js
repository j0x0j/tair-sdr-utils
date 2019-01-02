const cp = require('child_process')
const uuidv4 = require('uuid/v4')
const wav = require('wav')
const kue = require('kue')
const jobs = kue.createQueue()
const dotenv = require('dotenv')
const redisClient = jobs.client
const simpleTimer = require('node-timers/simple')
const simple = simpleTimer({ pollInterval: 100 })

const config = dotenv.load().parsed
const MARKET = config.MARKET
const SAMPLE_TIME = +config.SAMPLE_TIME
const STATION = process.env.band || process.argv[2]
const DEVICE = process.env.device || process.argv[3]

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

simple.start()

child1.stdout.on('data', chunk => {
  const now = Date.now()
  // Pause stream to manage backpressure manually]
  child1.stdout.pause()
  // Define the recurring file stream
  // Get the current timer elapsed time
  let time = simple.time()
  if (time >= SAMPLE_TIME) {
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
      // Resume stream manually
      child1.stdout.resume()
      // Only write after previous stream has ended
      ws.write(chunk)
    })
    // Close the current stream
    ws.end()
    // Generate a new sample id
    uuid = uuidv4()
    // Reset timer
    simple.reset().start()
    // Create new sample file
    ws = new wav.FileWriter(`./samples/sample_${uuid}.wav`, opts)
    ws.on('error', writeStreamErrorHandler)
  } else {
    // Resume stream manually
    // before write to not fail on error
    child1.stdout.resume()
    ws.write(chunk)
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
})

process.on('uncaughtException', err => {
  console.log('uncaughtException in multiplex at:', new Date())
  console.log('Station: %s, Device: %s', STATION, DEVICE)
  console.error(err)
  child1.kill('SIGINT')
  process.exit(1)
})
