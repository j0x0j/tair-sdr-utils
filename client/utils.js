const Interface = require('./Interface')
const validator = new Interface()
// const ROUND_ID = 1

// Lets try setting some stake
// remember to unlock clinet account
// personal.unlockAccount(address, password)

validator.events.on('data', (event) => {
  console.log('EVENT:', event)
})

validator.events.on('error', (err) => {
  console.log('ERROR:', err)
})

// const value = validator.utils.toWei('0.01', 'ether')
// console.log('VALUE:', value)

// validator.addStake(value)
//   .then(receipt => {
//     console.log('RECEIPT', receipt)
//   })
//   .catch(err => {
//     console.log('ERROR', err)
//   })

// validator.createRound(30, value)
//   .then(receipt => {
//     console.log('RECEIPT', receipt)
//   })
//   .catch(err => {
//     console.log('TXN ERROR', err)
//   })

// validator.getRound(ROUND_ID)
//   .then(data => {
//     console.log('DATA', data.valueOf())
//   })
//   .catch(err => {
//     console.log('CALL ERROR', err)
//   })

// validator.commitMatch(ROUND_ID, 30)
//   .then(receipt => {
//     console.log('RECEIPT', receipt)
//   })
//   .catch(err => {
//     console.log('TXN ERROR', err)
//   })

// validator.revealMatch(ROUND_ID, 30)
//   .then(receipt => {
//     console.log('RECEIPT', receipt)
//   })
//   .catch(err => {
//     console.log('TXN ERROR', err)
//   })

// validator.finalizeRound(ROUND_ID, 32)
//   .then(receipt => {
//     console.log('RECEIPT', receipt)
//   })
//   .catch(err => {
//     console.log('TXN ERROR', err)
//   })

// validator.getRandomBytesForRound(ROUND_ID)
//   .then(receipt => {
//     console.log('RECEIPT', receipt)
//   })
//   .catch(err => {
//     console.log('TXN ERROR', err)
//   })
