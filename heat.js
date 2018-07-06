const fs = require('fs')
const parse = require('csv-parse')
const parser = parse({ delimiter: ';' })
const transform = require('stream-transform')
const path = require('path')
const stream = fs.createReadStream(path.join(__dirname, '/parsed_matches_11-7-al-8.log.csv'))

const reduced = {}

parser.on('error', function (err) {
  console.log(err.message)
})

const transformer = transform(record => {
  const date = new Date(record[4])
  console.log(date.toLocaleString())
  const day = date.getDate()
  const hour = date.getHours()

  // if (!reduced[station]) {
  //   reduced[station] = {}
  // }
  if (!reduced[day]) {
    reduced[day] = {}
  }
  if (!reduced[day][hour]) {
    reduced[day][hour] = 1
  } else {
    reduced[day][hour] = reduced[day][hour] + 1
  }

  // get day and hour
  // add to counter for station - day - hour
  // console.log(record)
}, { parallel: 1 })

transformer.on('end', () => {
  console.log('<<END>>')
  console.log(reduced)
})

stream.pipe(parser).pipe(transformer).pipe(process.stdout)
