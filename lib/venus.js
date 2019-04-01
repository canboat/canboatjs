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

const debug = require('debug')('canboatjs:venus')
const Transform = require('stream').Transform
const FromPgn = require('./fromPgn').Parser
const _ = require('lodash')

function VenusStream (options) {
  if (!(this instanceof VenusStream)) {
    return new VenusStream(options)
  }

  Transform.call(this, {
    objectMode: true
  })

  this.options = options

  this.fromPgn = new FromPgn(options)

  debug('created FromPgn')

  /*
  this.fromPgn.on('pgn', pgn => {
  })
*/

  this.fromPgn.on('warning', (pgn, warning) => {
    debug(`[warning] ${pgn.pgn} ${warning}`)
  })

  this.fromPgn.on('error', (pgn, error) => {
    debug(`[error] ${pgn.pgn} ${error}`)
  })

  
  /*
  if ( this.options.app ) {
    options.app.on('nmea2000out', (msg) => {
      that.sendActisensePGN(msg)
    })
    options.app.on('nmea2000JsonOut', (msg) => {
      that.sendPGN(msg)
    })

    this.sendString('$PDGY,N2NET_OFFLINE')

    debug('started')
    //this.options.app.emit('nmea2000OutAvailable')
  }
  */
}

require('util').inherits(VenusStream, Transform)


VenusStream.prototype._transform = function (pgn, encoding, done) {
  //let line = chunk.toString().trim()
  //line = line.substring(0, line.length) // take off the \r

  this.fromPgn.parseVenusMQTT(pgn, (error, pgn) => {
    if ( !error ) {
      this.push(pgn)
      this.options.app.emit('N2KAnalyzerOut', pgn)
    }

    done()
  })
}

VenusStream.prototype.end = function () {
}

module.exports = VenusStream
