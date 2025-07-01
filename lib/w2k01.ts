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

import { PGN } from '@canboat/pgns'
import { debug as _debug } from 'debug'
const debug = _debug('canboatjs:w2k01')
const debugData = _debug('canboatjs:w2k01-data')
import {Transform} from 'stream'
import { pgnToActisenseN2KAsciiFormat, actisenseToN2KAsciiFormat, pgnToN2KActisenseFormat, actisenseToN2KActisenseFormat } from './toPgn'
import { readN2KActisense } from './n2k-actisense'

//const pgnsSent = {}

const N2K_ASCII = 0
const N2K_ACTISENSE = 1

export function W2K01Stream (this:any, options:any, type:string, outEvent:string) {
  /*
  if (!(this instanceof W2K01Stream)) {
    return new W2K01Stream(options)
    }
  */

  Transform.call(this, {
    objectMode: true
  })

  this.sentAvailable = false
  this.options = options
  this.outEvent = outEvent || 'w2k-1-out'

  this.format = type === 'ascii' ? N2K_ASCII : N2K_ACTISENSE

  if ( this.format === N2K_ASCII ) {
    if ( options.app ) {
      options.app.on(this.options.outEevent || 'nmea2000out', (msg:string) => {
        if ( typeof msg === 'string' ) {
          this.sendW2KPGN(msg)
        } else {
          this.sendPGN(msg)
        }
        options.app.emit('connectionwrite', { providerId: options.providerId })
      })
      
      options.app.on(options.jsonOutEvent || 'nmea2000JsonOut', (msg:PGN) => {
        this.sendPGN(msg)
        options.app.emit('connectionwrite', { providerId: options.providerId })
      })
    }
  }

  debug('started')
}

W2K01Stream.prototype.send = function (msg:string|Buffer) {
  debug('sending %s', msg)
  this.options.app.emit(this.outEvent, msg)
}

W2K01Stream.prototype.sendPGN = function (pgn:PGN) {
  let now = Date.now()
  //let lastSent = pgnsSent[pgn.pgn]
  if ( this.format === N2K_ASCII ) {
    let ascii = pgnToActisenseN2KAsciiFormat(pgn)
    this.send(ascii + '\r\n')
  } else {
    let buf = pgnToN2KActisenseFormat(pgn)
    this.send(buf)
  }
  //pgnsSent[pgn.pgn] = now
}

W2K01Stream.prototype.sendW2KPGN = function (msg:string) {
  if ( this.format === N2K_ASCII ) {
    let ascii = actisenseToN2KAsciiFormat(msg)
    this.send(ascii + '\r\n')
  } else {
    let buf = actisenseToN2KActisenseFormat
    this.send(buf)
  }
}

require('util').inherits(W2K01Stream, Transform)

W2K01Stream.prototype._transform = function (chunk:any, encoding:string, done:any) {
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
    readN2KActisense(chunk, this.plainText, this, (data:any) => {
      this.push(data)
    })
  }
  
  done()
}

W2K01Stream.prototype.pipe = function (pipeTo:any) {
  if ( !pipeTo.fromPgn ) {
    this.plainText = true
  } else {
    this.plainText = false
  }
  return (W2K01Stream as any).super_.prototype.pipe.call(this, pipeTo)
}


W2K01Stream.prototype.end = function () {
}

