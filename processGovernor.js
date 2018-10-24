const dotenv = require('dotenv')
const kue = require('kue')
const jobs = kue.createQueue()
const config = dotenv.load().parsed

const removeInactiveJobs = () => {
  jobs.inactive((err, ids) => {
    if (err) throw err
    ids.forEach(id => {
      kue.Job.get(id, (err, job) => {
        if (err) throw err
        job.remove()
      })
    })
  })
}

const checkInactiveJobCount = () => {
  jobs.inactiveCount((err, total) => {
    if (err) throw err
    if (total > +config.CONCURRENT_JOBS * 100) {
      removeInactiveJobs()
      // Should restart worker-remote
    }
  })
}

jobs.watchStuckJobs()

// Check inactive job count every 10 seconds
setInterval(checkInactiveJobCount, 10000)

// Start Queue Server
kue.app.listen(3000)
