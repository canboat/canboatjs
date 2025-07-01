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
import { toPgn, pgnToiKonvertSerialFormat } from './toPgn'
import { Parser } from './fromPgn'
import _ from 'lodash'
import { defaultTransmitPGNs } from './codes'
import util from 'util'

const debug = createDebug('canboatjs:ikonvert')

//const pgnsSent = {}

export function iKonvertStream(this: any, options: any) {
  if (this == undefined) {
    return new (iKonvertStream as any)(options)
  }

  Transform.call(this, {
    objectMode: true
  })

  this.isTcp = options.tcp === true

  this.outEvent = this.isTcp ? 'navlink2-out' : 'ikonvertOut'

  this.plainText = false
  this.reconnect = options.reconnect || true
  this.options = options
  this.cansend = false
  this.buffer = Buffer.alloc(500)
  this.bufferOffset = 0
  this.start()

  this.setProviderStatus =
    options.app && options.app.setProviderStatus
      ? (msg: string) => {
          options.app.setProviderStatus(options.providerId, msg)
        }
      : () => {}
  this.setProviderError =
    options.app && options.app.setProviderError
      ? (msg: string) => {
          options.app.setProviderError(options.providerId, msg)
        }
      : () => {}

  this.transmitPGNs = defaultTransmitPGNs
  if (this.options.transmitPGNs) {
    this.transmitPGNs = _.union(this.transmitPGNs, this.options.transmitPGNs)
  }

  // eslint-disable-next-line @typescript-eslint/no-this-alias
  const that = this

  if (this.options.app) {
    options.app.on(this.options.outEevent || 'nmea2000out', (msg: string) => {
      if (typeof msg === 'string') {
        that.sendActisensePGN(msg)
      } else {
        that.sendPGN(msg)
      }
      options.app.emit('connectionwrite', { providerId: options.providerId })
    })
    options.app.on(options.jsonOutEvent || 'nmea2000JsonOut', (msg: PGN) => {
      that.sendPGN(msg)
      options.app.emit('connectionwrite', { providerId: options.providerId })
    })

    this.isSetup = false
    //this.cansend = true
    this.state = 0
    this.setupCommands = this.getSetupCommands()
    this.expecting = false

    debug('started')
  }
}

util.inherits(iKonvertStream, Transform)

iKonvertStream.prototype.start = function () {}

iKonvertStream.prototype.sendString = function (msg: string) {
  debug('sending %s', msg)
  if (this.isTcp) {
    msg = msg + '\n\r'
  }
  this.options.app.emit(this.outEvent, msg)
}

iKonvertStream.prototype.sendPGN = function (pgn: PGN) {
  if (this.cansend) {
    //let now = Date.now()
    //let lastSent = pgnsSent[pgn.pgn]
    const msg = pgnToiKonvertSerialFormat(pgn)
    this.sendString(msg)
    //pgnsSent[pgn.pgn] = now
  }
}

iKonvertStream.prototype.sendActisensePGN = function (msg: string) {
  if (this.cansend) {
    if (!this.parser) {
      this.parser = new Parser(this.options)

      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const that = this
      this.parser.on('error', (pgn: PGN, error: any) => {
        console.error(`Error parsing ${pgn.pgn} ${error}`)
        console.error(error.stack)
      })

      this.parser.on('pgn', (pgn: PGN) => {
        //let now = Date.now()
        //let lastSent = pgnsSent[pgn.pgn]
        const msg = pgnToiKonvertSerialFormat(pgn)
        that.sendString(msg)
        //pgnsSent[pgn.pgn] = now
      })
    }
    this.parser.parseString(msg)
  }
}

iKonvertStream.prototype.setup = function () {
  let txPgns = '$PDGY,TX_LIST'
  this.transmitPGNs.forEach((pgn: number) => {
    txPgns = txPgns + `,${pgn}`
  })
  debug('sending pgn tx list')
  this.sendString(txPgns)
}

iKonvertStream.prototype.getSetupCommands = function () {
  let txPgns = '$PDGY,TX_LIST'
  this.transmitPGNs.forEach((pgn: number) => {
    txPgns = txPgns + `,${pgn}`
  })

  const setupCommands = []

  setupCommands.push('$PDGY,N2NET_OFFLINE:$PDGY,TEXT,Digital_Yacht_')
  if (this.isTcp) {
    setupCommands.push('$PDGY,N2NET_MODE,15:$PDGY,ACK,N2NET_MODE')
  }
  setupCommands.push('$PDGY,TX_LIMIT,OFF:$PDGY,') // NACK is ok with old firmware
  setupCommands.push(`${txPgns}:$PDGY,ACK,TX_LIST`)
  setupCommands.push('$PDGY,N2NET_INIT,ALL:$PDGY,ACK,N2NET_INIT,ALL')

  return setupCommands
}

iKonvertStream.prototype._transform = function (
  chunk: any,
  encoding: string,
  done: any
) {
  let line = chunk.toString().trim()
  line = line.substring(0, line.length) // take off the \r

  if (line.startsWith('$PDGY,TEXT')) {
    debug(line)
  } else if (line.startsWith('$PDGY,000000,')) {
    const parts = line.split(',')

    //FIXME, camelCase?
    if (this.options.sendNetworkStats && parts[2] && parts[2].length > 0) {
      const pgn = {
        pgn: 0x40100,
        prio: 7,
        dst: 255,
        src: 0,
        'CAN network load': Number(parts[2]),
        Errors: Number(parts[3]),
        'Device count': Number(parts[4]),
        Uptime: Number(parts[5]),
        'Gateway address': Number(parts[6]),
        'Rejected TX requests': Number(parts[7])
      }
      const buf = toPgn(pgn)
      if (buf) {
        this.push(
          `!PDGY,${pgn.pgn},${pgn.prio},${pgn.src},${pgn.dst},0,${buf.toString('base64')}`
        )
      }
      done()
      return
    }
  } else if (line.startsWith('$PDGY,NAK')) {
    const parts = line.split(',')
    const msg = `NavLink2 error ${parts[2]}: ${parts[3]}`
    console.error(msg)
    //this.setProviderError(msg)
  }

  if (!this.isSetup) {
    debug(line)
    let command = this.setupCommands[this.state].split(':')
    if (!this.expecting) {
      this.sendString(command[0])
      this.expecting = true
      this.sentTime = Date.now()
      debug(`Waiting for ${command[1]}`)
    } else {
      if (line.startsWith(command[1])) {
        this.state = this.state + 1

        if (this.state == this.setupCommands.length) {
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
      } else if (Date.now() - this.sentTime > 5000) {
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

iKonvertStream.prototype.end = function () {}
