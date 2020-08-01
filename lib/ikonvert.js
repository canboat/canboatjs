/**
 * Copyright 2018 Scott Bender (scott@scottbender.net)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const debug = require('debug')('canboatjs:ikonvert')
const Transform = require('stream').Transform
const isArray = require('lodash').isArray
const BitStream = require('bit-buffer').BitStream
const BitView = require('bit-buffer').BitView
const {toPgn, pgnToiKonvertSerialFormat} = require('./toPgn')
const Parser = require('./fromPgn').Parser
const _ = require('lodash')
const CanDevice = require('./candevice')
const spawn = require('child_process').spawn
const { defaultTransmitPGNs } = require('./codes')
const { parseCanId } = require('./canId')

const pgnsSent = {}

function iKonvertStream (options) {
  if (!(this instanceof iKonvertStream)) {
    return new iKonvertStream(options)
  }

  Transform.call(this, {
    objectMode: true
  })

  this.isTcp = options.tcp === true

  this.outEvent = this.isTcp? 'navlink2-out' : 'ikonvertOut'
  
  this.plainText = false
  this.reconnect = options.reconnect || true
  this.options = options
  this.cansend = false
  this.buffer = Buffer.alloc(500)
  this.bufferOffset = 0
  this.start()

  this.setProviderStatus = options.app && options.app.setProviderStatus
    ? (msg) => {
      options.app.setProviderStatus(options.providerId, msg)
    }
  : () => {}
  this.setProviderError = options.app && options.app.setProviderError
    ? (msg) => {
      options.app.setProviderError(options.providerId, msg)
    }
  : () => {}

  this.transmitPGNs = defaultTransmitPGNs
  if ( this.options.transmitPGNs ) {
    this.transmitPGNs = _.union(this.transmitPGNs,
                                this.options.transmitPGNs)
  }

  var that = this

  if ( this.options.app ) {
    options.app.on('nmea2000out', (msg) => {
      that.sendActisensePGN(msg)
    })
    options.app.on('nmea2000JsonOut', (msg) => {
      that.sendPGN(msg)
    })

    this.isSetup = false
    this.state = 0
    this.setupCommands = this.getSetupCommands()
    this.expecting = false

    debug('started')
  }
}

require('util').inherits(iKonvertStream, Transform)

iKonvertStream.prototype.start = function () {
}

iKonvertStream.prototype.sendString = function (msg) {
  debug('sending %s', msg)
  if ( this.isTcp ) {
    msg = msg + "\n\r"
  }
  this.options.app.emit(this.outEvent, msg)
}

iKonvertStream.prototype.sendPGN = function (pgn) {
  if ( this.cansend ) {
    let now = Date.now()
    let lastSent = pgnsSent[pgn.pgn]
    let msg = pgnToiKonvertSerialFormat(pgn)
    this.sendString(msg)
    pgnsSent[pgn.pgn] = now
  }
}

iKonvertStream.prototype.sendActisensePGN = function (msg) {
  if ( this.cansend ) {
    if ( !this.parser ) {
      this.parser = new Parser()

      let that = this
      this.parser.on('error', (pgn, error) => {
        console.error(`Error parsing ${pgn.pgn} ${error}`)
        console.error(error.stack)
      })

      this.parser.on('pgn', (pgn) => {
        let now = Date.now()
        let lastSent = pgnsSent[pgn.pgn]
        let msg = pgnToiKonvertSerialFormat(pgn)
        that.sendString(msg)
        pgnsSent[pgn.pgn] = now
      })
    }
    this.parser.parseString(msg)
  }
}

iKonvertStream.prototype.setup = function () {
  let txPgns = '$PDGY,TX_LIST'
  this.transmitPGNs.forEach(pgn => {
    txPgns = txPgns + `,${pgn}`
  })
  debug('sending pgn tx list')
  this.sendString(txPgns)
}

iKonvertStream.prototype.getSetupCommands = function () {
  let txPgns = '$PDGY,TX_LIST'
  this.transmitPGNs.forEach(pgn => {
    txPgns = txPgns + `,${pgn}`
  })

  const setupCommands = [];

  setupCommands.push('$PDGY,N2NET_OFFLINE:$PDGY,TEXT,Digital_Yacht_')
  if ( this.isTcp ) {
    setupCommands.push('$PDGY,N2NET_MODE,15:$PDGY,ACK,N2NET_MODE')
  }
  setupCommands.push('$PDGY,TX_LIMIT,OFF:$PDGY,') // NACK is ok with old firmware
  setupCommands.push(`${txPgns}:$PDGY,ACK,TX_LIST`)
  setupCommands.push('$PDGY,N2NET_INIT,ALL:$PDGY,ACK,N2NET_INIT,ALL')

  return setupCommands
}

iKonvertStream.prototype._transform = function (chunk, encoding, done) {
  let line = chunk.toString().trim()
  line = line.substring(0, line.length) // take off the \r

  if ( line.startsWith('$PDGY,TEXT') ) {
    debug(line)
  } else if ( line.startsWith('$PDGY,NAK') ) {
    let parts = line.split(',')
    let msg = `NavLink2 error ${parts[2]}: ${parts[3]}`
    console.error(msg)
    this.setProviderError(msg)
  }

  if ( !this.isSetup ) {
    debug(line)
    let command = this.setupCommands[this.state].split(':')
    if ( !this.expecting ) {
      this.sendString(command[0])
      this.expecting = true
      this.sentTime = Date.now()
      debug(`Waiting for ${command[1]}`)
    } else {
      if ( line.startsWith(command[1]) ) {
        this.state = this.state + 1
        
        if ( this.state == this.setupCommands.length ) {
          this.isSetup = true
          this.cansend = true
          this.options.app.emit('nmea2000OutAvailable')
          debug('Setup completed')
        } else {
          command = this.setupCommands[this.state].split(':')
          this.sendString(command[0])
          this.expecting = true
          this.sentTime = Date.now()
          debug(`Waiting for ${command[1]}`)
        }
      } else if ( Date.now() - this.sentTime > 5000 ) {
        debug(`Did not receive expected: ${command[1]}, retrying...`)
        this.sendString(command[0])
        this.sentTime = Date.now()
      }
    }
  } else {
    this.push(line)
  }
  
  done()
}

iKonvertStream.prototype.end = function () {
}

module.exports = iKonvertStream
