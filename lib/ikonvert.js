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
const { getPGNFromCanId, actisenseSerialToBuffer, defaultTransmitPGNs } = require('./utilities')

const pgnsSent = {}
const rateLimit = 200

function iKonvertStream (options) {
  if (!(this instanceof iKonvertStream)) {
    return new iKonvertStream(options)
  }

  Transform.call(this, {
    objectMode: true
  })

  this.plainText = false
  this.reconnect = options.reconnect || true
  this.options = options
  this.cansend = false
  this.buffer = new Buffer(500)
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

  var that = this

  if ( this.options.app ) {
    options.app.on('nmea2000out', (msg) => {
      that.sendActisensePGN(msg)
    })
    options.app.on('nmea2000JsonOut', (msg) => {
      that.sendPGN(msg)
    })

    this.sendString('$PDGY,N2NET_OFFLINE')

    debug('started')
  }
}

require('util').inherits(iKonvertStream, Transform)

iKonvertStream.prototype.start = function () {
}

iKonvertStream.prototype.sendString = function (msg) {
  debug('sending %s', msg)
  this.options.app.emit('ikonvertOut', msg)
}

iKonvertStream.prototype.sendPGN = function (pgn) {
  if ( this.cansend ) {
    let now = Date.now()
    let lastSent = pgnsSent[pgn.pgn]
    if ( !lastSent || now - lastSent > rateLimit ) {
      let msg = pgnToiKonvertSerialFormat(pgn)
      this.sendString(msg)
      pgnsSent[pgn.pgn] = now
    }
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
        if ( !lastSent || now - lastSent > rateLimit ) {
          let msg = pgnToiKonvertSerialFormat(pgn)
          that.sendString(msg)
          pgnsSent[pgn.pgn] = now
        }
      })
    }
    this.parser.parseString(msg)
  }
}

iKonvertStream.prototype.setup = function () {
  let txPgns = '$PDGY,TX_LIST'
  defaultTransmitPGNs.forEach(pgn => {
    txPgns = txPgns + `,${pgn}`
  })
  debug('sending pgn tx list')
  this.sendString(txPgns)
}

iKonvertStream.prototype._transform = function (chunk, encoding, done) {
  let line = chunk.toString().trim()
  line = line.substring(0, line.length) // take off the \r

    if ( line.startsWith('$PDGY') ) {
    if ( line === '$PDGY,000000,,,,,,' ) {
      //the iKonvert is not initialized
      if ( !this.didSetup ) {
        this.setup()
        this.setProviderStatus('Initializing...')
        this.didSetup = true
      }
    } else if ( line === '$PDGY,ACK,TX_LIST' ) {
      debug('sending net init')
      this.sendString('$PDGY,N2NET_INIT,ALL')
      this.setProviderStatus('Initialized...')
    } else if ( line === '$PDGY,ACK,N2NET_INIT,ALL' && !this.cansend ) {
      this.cansend = true;
      this.options.app.emit('nmea2000OutAvailable')
      //this.sendString('$PDGY,SHOW_LISTS')
    } else if ( line.startsWith('$PDGY,TEXT') ) {
      debug(line)
    } else if ( line.startsWith('$PDGY,000000') ) {
      let parts = line.split(',')
      debug('ikonvert can address: %s', parts[6])
      debug(line)
    } else if ( line.startsWith('$PDGY,NAK') ) {
      let parts = line.split(',')
      let msg = `iKonvert error ${parts[2]}: ${parts[3]}`
      console.error(msg)
      this.setProviderError(msg)
    }
  } else {
    this.push(line)
  }

  done()
}

iKonvertStream.prototype.end = function () {
}

module.exports = iKonvertStream
