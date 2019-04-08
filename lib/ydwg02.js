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

const debug = require('debug')('canboatjs:ydwg02')
const Transform = require('stream').Transform
const FromPgn = require('./fromPgn').Parser
const Parser = require('./fromPgn').Parser
const _ = require('lodash')
const { getCanIdFromYdwgPGN, getPGNFromCanId, actisenseSerialToBuffer, defaultTransmitPGNs } = require('./utilities')
const { pgnToYdwgRawFormat } = require('./toPgn')

const pgnsSent = {}
const rateLimit = 200

function Ydwg02Stream (options) {
  if (!(this instanceof Ydwg02Stream)) {
    return new Ydwg02Stream(options)
  }

  Transform.call(this, {
    objectMode: true
  })

  this.options = options

  this.fromPgn = new FromPgn(options)

  this.fromPgn.on('pgn', pgn => {
    this.push(pgn)
    options.app.emit('N2KAnalyzerOut', pgn)
  })

  this.fromPgn.on('warning', (pgn, warning) => {
    debug(`[warning] ${pgn.pgn} ${warning}`)
  })

  this.fromPgn.on('error', (pgn, error) => {
    debug(`[error] ${pgn.pgn} ${error}`)
  })


  if ( this.options.app ) {
    options.app.on('nmea2000out', (msg) => {
      this.sendYdwgPGN(msg)
    })

    options.app.on('nmea2000JsonOut', (msg) => {
      this.sendPGN(msg)
    })

    //this.sendString('$PDGY,N2NET_OFFLINE')

    debug('started')
    //this.options.app.emit('nmea2000OutAvailable')
  }

}

Ydwg02Stream.prototype.sendString = function (msg) {
  debug('sending %s', msg)
  this.options.app.emit('ydwg02-out', msg)
}

Ydwg02Stream.prototype.sendPGN = function (pgn) {
  let now = Date.now()
  let lastSent = pgnsSent[pgn.pgn]
  if ( !lastSent || now - lastSent > rateLimit ) {
    pgnToYdwgRawFormat(pgn).forEach(raw => {
      this.sendString(raw)
    })
    pgnsSent[pgn.pgn] = now
  }
}

Ydwg02Stream.prototype.sendYdwgPGN = function (msg) {
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
        pgnToYdwgRawFormat(pgn).forEach(raw => {
          this.sendString(raw)
        })
        pgnsSent[pgn.pgn] = now
      }
    })
  }
  this.parser.parseString(msg)
}

require('util').inherits(Ydwg02Stream, Transform)


Ydwg02Stream.prototype._transform = function (chunk, encoding, done) {
  let line = chunk.toString().trim()
  //line = line.substring(0, line.length) // take off the \r

  this.fromPgn.parseYDWG02(line)
  done()
}

Ydwg02Stream.prototype.end = function () {
}

module.exports = Ydwg02Stream
