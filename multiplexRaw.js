const fs = require('fs')
const cp = require('child_process')
const simpleTimer = require('node-timers/simple')
const uuidv4 = require('uuid/v4')

const STATION = '106.9M'

const child1 = cp.spawn('rtl_fm', [
  '-f', STATION,
  '-M', 'fm',
  '-s', '170k',
  '-A', 'std',
  '-l', '0',
  '-E', 'deemp',
  '-r', '44.1k'
])

let uuid = uuidv4()
let ws = fs.createWriteStream(`./raw/sample_${uuid}.raw`)

const simple = simpleTimer({ pollInterval: 100 })
simple.start()

child1.stdout.on('data', chunk => {
  let time = simple.time()
  if (time >= 5000) {
    uuid = uuidv4()
    simple.reset().start()
    ws.end()
    ws = fs.createWriteStream(`./raw/sample_${uuid}.raw`)
  }
  ws.write(chunk)
})

// child1.stdout.pipe(process.stdout)
child1.stderr.pipe(process.stdout)
