const fs = require('fs')
const kue = require('kue')
const cp = require('child_process')
const jobs = kue.createQueue()
const log = fs.createWriteStream(__dirname + '/matches.log', { flags : 'w' })

const BASE_PATH = '/Users/jo/projects/tair'
const NODE_APP_PATH = `${BASE_PATH}/sdr`
const DEJAVU_APP_PATH = `${BASE_PATH}/dejavu`

jobs.process('sample', 4, (job, done) => {
  console.log('New Sample Job:', job.data.uuid)

  const SAMPLE_PATH = `${NODE_APP_PATH}/samples/sample_${job.data.uuid}.wav`

  console.log('SAMPLE_PATH', SAMPLE_PATH)

  const child1 = cp.spawn('python2.7', [
    `${DEJAVU_APP_PATH}/dejavu.py`,
    '--config',
    `${DEJAVU_APP_PATH}/dejavu.cnf.SAMPLE`,
    '--recognize',
    'file',
    SAMPLE_PATH
  ])

  child1.stdout.on('data', chunk => {
    try {
      const textChunk = chunk.toString('utf8')
      const data = JSON.parse(textChunk)
      console.log('DATA', data)
      if (
        data &&
        data.confidence &&
        data.confidence >= 110
      ) {
        // is a match, should do further processing
        log.write(`${job.data.stn};${data.confidence};${data.song_name};${job.data.uuid};${new Date().toISOString()}` + '\n')
      } else {
        fs.unlinkSync(SAMPLE_PATH)
      }
    } catch (e) {
      return done(e)
    }
    done()
  })

  child1.stdout.on('error', e => {
    console.log('ERROR', e)
    try {
      fs.unlinkSync(SAMPLE_PATH)
    } catch (e) {
      return done(e)
    }
    done(e)
  })
})

kue.app.listen(3000)
