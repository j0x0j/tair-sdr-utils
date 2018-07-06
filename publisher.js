const fs = require('fs')
const parse = require('csv-parse')
const parser = parse({ delimiter: ';' })
const transform = require('stream-transform')
const request = require('request')
const path = require('path')
const stream = fs.createReadStream(path.join(__dirname, '/parsed_matches_11-6.log.csv'))

parser.on('error', function (err) {
  console.log(err.message)
})

const transformer = transform((record, callback) => {
  const station = record[0]
  const creative = record[2]
  const sample = record[3]
  const createdAt = record[4]
  const options = {
    method: 'POST',
    url: 'https://bmp.tair.network/log',
    json: true,
    body: {
      station,
      creative,
      sample,
      createdAt
    }
  }
  request(options, (err, res) => {
    callback(err, record.join(';') + '\n')
  })
}, { parallel: 1 })

stream.pipe(parser).pipe(transformer).pipe(process.stdout)
