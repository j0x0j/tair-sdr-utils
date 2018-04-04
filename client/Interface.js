const dotenv = require('dotenv')
const events = require('events')
const util = require('util')
const Web3 = require('web3')
const TairProtocol = require('./abi/TairProtocolAbi.json')
const web3 = new Web3(new Web3.providers.WebsocketProvider('ws://localhost:8545'))

const config = dotenv.load().parsed
const contractAddress = config.CONTRACT_RINKEBY_ADDRESS
const clientAddress = config.CLIENT_ADDRESS

class Interface {
  constructor () {
    this.contract = new web3.eth.Contract(TairProtocol, contractAddress)
    this.clientAddress = clientAddress
    // Need to have state for playing Rounds
    this.state = {
      rounds: {}
    }
    this.events = this.contract.events.allEvents({
      fromBlock: config.CONTRACT_BLOCK_HEIGHT
    })
    this.web3 = web3
    this.utils = web3.utils
    this.currentBlock = {}
    // Event emiiter interface
    events.EventEmitter.call(this)
  }

  get address () {
    return this.contract.options.address
  }

  get network () {
    return 'Rinkeby'
  }

  get blockNumber () {
    return this.currentBlock.number
  }

  set block (data) {
    this.currentBlock = data
  }

  /**
  * @description Create a validation Round
  * @param {int} sampleId the external id for the sample to match against
  * @param {BigNumber} value the amount of eth to set as bounty for a Round
  * @returns {Promise} that should resolve with a transaction receipt
  */
  createRound (sampleId, value) {
    if (!sampleId) {
      throw new Error('No sampleId provided')
    }
    if (!value) {
      throw new Error('Need to set value for bounty')
    }
    return this.contract.methods.createRound(sampleId).send({
      from: this.clientAddress, value, gas: 500000
    })
  }

  /**
  * @description Add stake to a validator account
  * @param {BigNumber} value the amount of eth to stake
  * @returns {Promise} that should resolve with a transaction receipt
  */
  addStake (value) {
    const address = this.clientAddress
    return this.contract.methods.addStake(address).send({
      from: this.clientAddress, value, gas: 100000
    })
  }

  /**
  * @description Commit a hashed match for a Round
  * @param {int} roundId the round to commit to
  * @param {int} matchId the external id for a match
  * @returns {Promise} that should resolve with a transaction receipt
  */
  commitMatch (roundId, matchId) {
    // need a real random integer here
    const salt = Math.floor(Math.random() * 99999) + 1
    // typecast to string for keccak256
    const secret = web3.utils.soliditySha3(
      matchId.toString(), salt.toString()
    )
    // Save a map in state of Round<>salt
    this.state.rounds[`roundNum${roundId}`] = salt
    return this.contract.methods.commitMatch(roundId, secret).send({
      from: this.clientAddress, gas: 110000
    })
  }

  /**
  * @description Reveal a match for a committed Round
  * @param {int} roundId the round to commit to
  * @param {int} matchId the external id for a match
  * @returns {Promise} that should resolve with a transaction receipt
  */
  revealMatch (roundId, matchId) {
    const salt = this.state.rounds[`roundNum${roundId}`]
    if (!salt) {
      throw new Error('No salt for this Round')
    }
    return this.contract.methods.revealMatch(roundId, matchId, salt).send({
      from: this.clientAddress, gas: 350000
    })
  }

  /**
  * @description A public function to finalize the round
  * for demo purposes
  * @param {int} roundId the round to commit to
  * @param {int} random a random integer between 1 and 100
  * @returns {Promise} that should resolve with a transaction receipt
  */
  finalizeRound (roundId, random) {
    return this.contract.methods.finalizeRound(roundId, random).send({
      from: this.clientAddress, gas: 5000000
    })
  }

  /**
  * @description Initialize Oraclize API call
  * @param {int} roundId the round to commit to
  * @returns {Promise} that should resolve with a transaction receipt
  */
  getRandomBytesForRound (roundId, random) {
    return this.contract.methods.getRandomBytesForRound(roundId).send({
      from: this.clientAddress, gas: 5000000
    })
  }

  /**
  * @description Get data for a Round
  * @param {int} roundId the round to commit to
  * @returns {Promise} that should resolve with a Round data
  */
  getRound (roundId) {
    return this.contract.methods.getRound(roundId).call()
  }

  /**
  * @description Check if winner, logs to console
  * @param {string} winner the address of the Round winner
  */
  checkWinner (winner) {
    if (winner === this.clientAddress) {
      console.log('.')
      console.log('=====')
      console.log('🏆🏆🏆🏆🏆🏆🏆')
      console.log('🏅🏅🏅🏅🏅🏅🏅')
      console.log('')
      console.log(' 💰 WINNER 💰 ')
      console.log('')
      console.log('🏅🏅🏅🏅🏅🏅🏅')
      console.log('🏆🏆🏆🏆🏆🏆🏆')
      console.log('=====')
      console.log('.')
    }
  }

  /**
  * @description Poll for new blocks
  * @emits newBlock events
  */
  pollForNewBlock (interval = 1000 * 15) {
    const self = this
    setInterval(function () {
      self.web3.eth.getBlock('pending', (error, block) => {
        if (error) {
          throw error
        }
        if (
          !self.block ||
          self.block.number !== block.number
        ) {
          self.block = block
          self.emit('newBlock', { data: self.blockNumber })
        } else {
          self.pollForNewBlock()
        }
      })
    }, interval)
  }
}

// Apply event emitter to class
util.inherits(Interface, events.EventEmitter)

module.exports = Interface
