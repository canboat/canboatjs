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

const debug = require('debug')('canboatjs:ydgw02')
const Transform = require('stream').Transform
const FromPgn = require('./fromPgn').Parser
const Parser = require('./fromPgn').Parser
const _ = require('lodash')
const { defaultTransmitPGNs } = require('./codes')
const { pgnToYdgwRawFormat, actisenseToYdgwRawFormat } = require('./toPgn')

const pgnsSent = {}
const rateLimit = 200

function Ydgw02Stream (options) {
  if (!(this instanceof Ydgw02Stream)) {
    return new Ydgw02Stream(options)
  }

  Transform.call(this, {
    objectMode: true
  })

  this.sentAvailable = false
  this.options = options

  this.fromPgn = new FromPgn(options)

  this.fromPgn.on('warning', (pgn, warning) => {
    debug(`[warning] ${pgn.pgn} ${warning}`)
  })

  this.fromPgn.on('error', (pgn, error) => {
    debug(`[error] ${pgn.pgn} ${error}`)
  })


  if ( this.options.app ) {
    options.app.on('nmea2000out', (msg) => {
      this.sendYdgwPGN(msg)
    })

    options.app.on('nmea2000JsonOut', (msg) => {
      this.sendPGN(msg)
    })

    //this.sendString('$PDGY,N2NET_OFFLINE')

    debug('started')
  }

}

Ydgw02Stream.prototype.sendString = function (msg) {
  debug('sending %s', msg)
  this.options.app.emit('ydgw02-out', msg)
  this.options.app.emit('ydwg02-out', msg)
}

Ydgw02Stream.prototype.sendPGN = function (pgn) {
  let now = Date.now()
  let lastSent = pgnsSent[pgn.pgn]
  if ( !lastSent || now - lastSent > rateLimit ) {
    pgnToYdgwRawFormat(pgn).forEach(raw => {
      this.sendString(raw)
    })
    pgnsSent[pgn.pgn] = now
  }
}

Ydgw02Stream.prototype.sendYdgwPGN = function (msg) {

  actisenseToYdgwRawFormat(msg).forEach(raw => {
    this.sendString(raw)
  })

  /*
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
  */
}

require('util').inherits(Ydgw02Stream, Transform)

Ydgw02Stream.prototype._transform = function (chunk, encoding, done) {
  let line = chunk.toString().trim()
  //line = line.substring(0, line.length) // take off the \r

  if ( !this.sentAvailable ) {
    debug('emit nmea2000OutAvailable')
    this.options.app.emit('nmea2000OutAvailable')
    this.sentAvailable = true
  }

  const pgn = this.fromPgn.parseYDGW02(line)
  if ( !_.isUndefined(pgn) ) {
    this.push(pgn)
    this.options.app.emit('N2KAnalyzerOut', pgn)
  }

  done()
}

Ydgw02Stream.prototype.end = function () {
}

module.exports = Ydgw02Stream
