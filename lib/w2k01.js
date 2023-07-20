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

const debug = require('debug')('canboatjs:w2k01')
const debugData = require('debug')('canboatjs:w2k01-data')
const Transform = require('stream').Transform
const _ = require('lodash')
const { pgnToActisenseN2KAsciiFormat, actisenseToN2KAsciiFormat, pgnToN2KActisenseFormat, actisenseToN2KActisenseFormat } = require('./toPgn')
const { readN2KActisense, encodeN2KActisense } = require('./n2k-actisense')

const pgnsSent = {}

const N2K_ASCII = 0
const N2K_ACTISENSE = 1

function W2K01Stream (options, type, outEvent) {
  if (!(this instanceof W2K01Stream)) {
    return new W2K01Stream(options)
  }

  Transform.call(this, {
    objectMode: true
  })

  this.sentAvailable = false
  this.options = options
  this.outEvent = outEvent || 'w2k-1-out'

  this.format = type === 'ascii' ? N2K_ASCII : N2K_ACTISENSE

  if ( this.format === N2K_ASCII ) {
    if ( options.app ) {
      options.app.on(this.options.outEevent || 'nmea2000out', (msg) => {
        if ( typeof msg === 'string' ) {
          this.sendW2KPGN(msg)
        } else {
          this.sendPGN(msg)
        }
      })
      
      options.app.on(options.jsonOutEvent || 'nmea2000JsonOut', (msg) => {
        this.sendPGN(msg)
      })
    }
  }

  debug('started')
}

W2K01Stream.prototype.send = function (msg) {
  debug('sending %s', msg)
  this.options.app.emit(this.outEvent, msg)
}

W2K01Stream.prototype.sendPGN = function (pgn) {
  let now = Date.now()
  let lastSent = pgnsSent[pgn.pgn]
  if ( this.format === N2K_ASCII ) {
    let ascii = pgnToActisenseN2KAsciiFormat(pgn)
    this.send(ascii + '\r\n')
  } else {
    let buf = pgnToN2KActisenseFormat(pgn)
    this.send(buf)
  }
  pgnsSent[pgn.pgn] = now
}

W2K01Stream.prototype.sendW2KPGN = function (msg) {
  if ( this.format === N2K_ASCII ) {
    let ascii = actisenseToN2KAsciiFormat(msg)
    this.send(ascii + '\r\n')
  } else {
    let buf = actisenseToN2KActisenseFormat
    this.send(buf)
  }
}

require('util').inherits(W2K01Stream, Transform)

W2K01Stream.prototype._transform = function (chunk, encoding, done) {
  if ( !this.sentAvailable && this.format === N2K_ASCII ) {
    debug('emit nmea2000OutAvailable')
    this.options.app.emit('nmea2000OutAvailable')
    this.sentAvailable = true
  }

  if ( this.format === N2K_ASCII ) {
    if ( debugData.enabled ) {
      debugData('Received: ' + chunk)
    }
    this.push(chunk)
  } else {
    readN2KActisense(chunk, this.plainText, this, (data) => {
      this.push(data)
    })
  }
  
  done()
}

W2K01Stream.prototype.pipe = function (pipeTo) {
  if ( !pipeTo.fromPgn ) {
    this.plainText = true
  } else {
    this.plainText = false
  }
  return W2K01Stream.super_.prototype.pipe.call(this, pipeTo)
}


W2K01Stream.prototype.end = function () {
}

module.exports = W2K01Stream
