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

import { PGN } from '@canboat/ts-pgns'
import { createDebug } from './utilities'
import { Transform } from 'stream'
import {
  pgnToActisenseN2KAsciiFormat,
  actisenseToN2KAsciiFormat,
  pgnToN2KActisenseFormat,
  actisenseToN2KActisenseFormat
} from './toPgn'
import { readN2KActisense } from './n2k-actisense'
import { CanDevice } from './candevice'
import util from 'util'

//const pgnsSent = {}

const N2K_ASCII = 0
const N2K_ACTISENSE = 1

export function W2K01Stream(
  this: any,
  options: any,
  type: string,
  outEvent: string
) {
  if (this === undefined) {
    return new (W2K01Stream as any)(options, type, outEvent)
  }

  Transform.call(this, {
    objectMode: true
  })

  this.debug = createDebug('canboatjs:w2k01', options)
  this.debugData = createDebug('canboatjs:w2k01-data', options)
  this.debugOut = createDebug('canboatjs:n2k-out', options)

  this.sentAvailable = false
  this.options = options
  this.outEvent = outEvent || 'w2k-1-out'

  this.format = type === 'ascii' ? N2K_ASCII : N2K_ACTISENSE

  if (this.format === N2K_ASCII) {
    if (options.app) {
      const outEvents = (this.options.outEvent || 'nmea2000out')
        .split(',')
        .map((event: string) => event.trim())
      outEvents.forEach((event: string) => {
        options.app.on(event, (msg: string) => {
          if (typeof msg === 'string') {
            this.sendW2KPGN(msg)
          } else {
            this.sendPGN(msg)
          }
          options.app.emit('connectionwrite', {
            providerId: options.providerId
          })
        })
      })

      const jsonOutEvents = (options.jsonOutEvent || 'nmea2000JsonOut')
        .split(',')
        .map((event: string) => event.trim())
      jsonOutEvents.forEach((event: string) => {
        options.app.on(event, (msg: PGN) => {
          this.sendPGN(msg)
          options.app.emit('connectionwrite', {
            providerId: options.providerId
          })
        })
      })
    }

    // When asked to "act as a CAN device", instantiate a CanDevice so we
    // respond to ISO Address Claim, Product Information, Heartbeat, etc.
    // The CanDevice listens for inbound parsed PGNs on `N2KAnalyzerOut`
    // (emitted by the CanboatJs pipe element) and calls back into our
    // `sendPGN` to deliver its responses through the W2K-1 ASCII encoder.
    if (options.app && options.actAsDevice) {
      this.candevice = new CanDevice(this, options)
      this.candevice.start()
    }
  }

  this.debug('started')
}

W2K01Stream.prototype.send = function (msg: string | Buffer) {
  this.debugOut('sending %s', msg)
  this.options.app.emit(this.outEvent, msg)
}

// The optional `_force` parameter is part of the contract `CanDevice` uses to
// drive its host transport; we always accept the PGN since the W2K-1 has no
// "address claim pending" gating of its own.
W2K01Stream.prototype.sendPGN = function (pgn: PGN, _force?: boolean) {
  //const now = Date.now()
  //let lastSent = pgnsSent[pgn.pgn]
  if (this.format === N2K_ASCII) {
    const ascii = pgnToActisenseN2KAsciiFormat(pgn)
    if (this.options.app.listenerCount('canboatjs:rawsend') > 0) {
      this.options.app.emit('canboatjs:rawsend', { data: ascii })
    }
    this.send(ascii + '\r\n')
  } else {
    const buf = pgnToN2KActisenseFormat(pgn)
    if (this.options.app.listenerCount('canboatjs:rawsend') > 0) {
      this.options.app.emit('canboatjs:rawsend', { data: buf })
    }
    this.send(buf)
  }
  //pgnsSent[pgn.pgn] = now
}

W2K01Stream.prototype.sendW2KPGN = function (msg: string) {
  if (this.format === N2K_ASCII) {
    const ascii = actisenseToN2KAsciiFormat(msg)
    if (this.options.app.listenerCount('canboatjs:rawsend') > 0) {
      this.options.app.emit('canboatjs:rawsend', { data: ascii })
    }
    this.send(ascii + '\r\n')
  } else {
    const buf = actisenseToN2KActisenseFormat
    if (this.options.app.listenerCount('canboatjs:rawsend') > 0) {
      this.options.app.emit('canboatjs:rawsend', { data: buf })
    }
    this.send(buf)
  }
}

util.inherits(W2K01Stream, Transform)

W2K01Stream.prototype._transform = function (
  chunk: any,
  encoding: string,
  done: any
) {
  if (!this.sentAvailable && this.format === N2K_ASCII) {
    this.debug('emit nmea2000OutAvailable')
    this.options.app.emit('nmea2000OutAvailable')
    this.sentAvailable = true
  }

  if (this.format === N2K_ASCII) {
    if (this.debugData.enabled) {
      this.debugData('Received: ' + chunk)
    }
    this.options.app.emit('canboatjs:rawoutput', chunk)
    this.push(chunk)
  } else {
    readN2KActisense(chunk, this.plainText, this, (data: any) => {
      this.push(data)
    })
  }

  done()
}

W2K01Stream.prototype.pipe = function (pipeTo: any) {
  if (!pipeTo.fromPgn) {
    this.plainText = true
  } else {
    this.plainText = false
  }
  return (W2K01Stream as any).super_.prototype.pipe.call(this, pipeTo)
}

W2K01Stream.prototype.end = function () {
  if (this.candevice) {
    this.candevice.stop()
    this.candevice = undefined
  }
}
