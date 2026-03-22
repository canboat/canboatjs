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
import { createDebug, byteStringArray } from './utilities'
import { Transform } from 'stream'
import { toPgn } from './toPgn'
import _ from 'lodash'
import { CanDevice } from './candevice'
import { getPlainPGNs, binToActisense } from './utilities'
import { CanID, encodeCanId, parseCanId } from './canId'
import { toActisenseSerialFormat, parseActisense } from './stringMsg'
import { CanChannel } from './canSocket'
import util from 'util'

export function CanbusStream(this: any, options: any) {
  if (this === undefined) {
    return new (CanbusStream as any)(options)
  }

  this.debug = createDebug('canboatjs:n2k-out', options)

  Transform.call(this, {
    objectMode: true
  })

  this.plainText = false
  this.options = options
  this.reconnecting = false // Guard flag to prevent concurrent reconnections
  this.stoppingChannel = false // Flag to track intentional stops
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

  if (options.fromStdIn) {
    return
  }

  // eslint-disable-next-line @typescript-eslint/no-this-alias
  const that = this

  if (options.app) {
    const outEvents = (options.outEvent || 'nmea2000out')
      .split(',')
      .map((event: string) => event.trim())
    outEvents.forEach((event: string) => {
      options.app.on(event, (msg: string) => {
        that.sendPGN(msg)
      })
    })

    const jsonOutEvents = (options.jsonOutEvent || 'nmea2000JsonOut')
      .split(',')
      .map((event: string) => event.trim())
    jsonOutEvents.forEach((event: string) => {
      options.app.on(event, (msg: PGN) => {
        that.sendPGN(msg)
      })
    })
  }

  // Store timeout value for timer recreation during reconnects
  this.noDataReceivedTimeout =
    typeof options.noDataReceivedTimeout !== 'undefined'
      ? options.noDataReceivedTimeout
      : -1

  if (this.connect() == false) {
    return
  }

  // Initial timer setup (will be recreated on each reconnect in connect())
  this._setupNoDataTimer()
}

// Setup or recreate the no-data monitoring timer
CanbusStream.prototype._setupNoDataTimer = function () {
  // Clear existing timer if present
  if (this.noDataInterval) {
    clearInterval(this.noDataInterval)
    this.noDataInterval = null
  }

  if (this.noDataReceivedTimeout > 0) {
    this.noDataInterval = setInterval(() => {
      if (
        this.channel &&
        this.lastDataReceived &&
        Date.now() - this.lastDataReceived > this.noDataReceivedTimeout * 1000
      ) {
        if (this.options.app) {
          console.error(
            `No data received for ${this.noDataReceivedTimeout}s, retrying...`
          )
        }
        this.setProviderError('No data received, retrying...')

        // Mark as intentional stop before stopping channel
        this.stoppingChannel = true
        const channel = this.channel
        delete this.channel
        try {
          channel.stop()
        } catch (_error) {
          console.error('Error stopping channel:', _error)
        }

        // Attempt reconnection
        this.connect()
      }
    }, this.noDataReceivedTimeout * 1000)
  }
}

CanbusStream.prototype.connect = function () {
  // Prevent concurrent reconnection attempts
  if (this.reconnecting) {
    if (this.options.app) {
      console.log('Reconnection already in progress, skipping...')
    }
    return false
  }

  this.reconnecting = true
  const canDevice = this.options.canDevice || 'can0'

  try {
    // Clean up old channel if it exists
    if (this.channel) {
      try {
        this.channel.removeAllListeners('onStopped')
        this.channel.removeAllListeners('onMessage')
        if (!this.stoppingChannel) {
          this.channel.stop()
        }
      } catch (e) {
        console.error('Error cleaning up old channel:', e)
      }
      delete this.channel
    }

    // Reset stopping flag
    this.stoppingChannel = false

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const that = this
    this.channel = new CanChannel(canDevice)
    this.channel.addListener('onStopped', () => {
      // Check if we still have a channel reference (not already handled)
      if (!this.channel) {
        return // Already handled by timeout or manual stop
      }

      // Check if this was an intentional stop by us
      const wasOurStop = this.stoppingChannel

      if (wasOurStop) {
        // We stopped it intentionally (e.g., from timeout handler), don't auto-reconnect
        if (this.options.app) {
          console.log(
            'Channel stopped intentionally, reconnection handled elsewhere'
          )
        }
        return
      }

      // External/unexpected stop - need to reconnect
      delete this.channel
      this.setProviderError('Stopped unexpectedly, Retrying...')
      if (this.options.app) {
        console.error('CAN channel stopped unexpectedly, retrying...')
      }

      setTimeout(() => {
        this.setProviderError('Reconnecting...')
        this.connect()
      }, 2000)
    })
    this.channel.addListener('onMessage', (msg: any) => {
      const pgn = parseCanId(msg.id)

      if (this.noDataInterval) {
        this.lastDataReceived = Date.now()
      }

      //always send address claims through
      if (
        pgn.pgn != 60928 &&
        that.candevice &&
        that.candevice.cansend &&
        pgn.src == that.candevice.address
      ) {
        return
      }

      let data: any
      if (that.plainText) {
        const timestamp = new Date().toISOString()
        data = binToActisense(pgn, timestamp, msg.data, msg.data.length)
        this.push(data)
        if (this.options.app.listenerCount('canboatjs:rawoutput') > 0) {
          this.options.app.emit('canboatjs:rawoutput', data)
        }
      } else {
        data = {
          pgn,
          length: msg.data.length,
          data: msg.data
        }

        if (this.options.app.listenerCount('canboatjs:rawoutput') > 0) {
          that.options.app.emit('canboatjs:rawoutput', {
            pgn,
            length: msg.data.length,
            data: byteStringArray(msg.data)
          })
        }

        that.push(data)
      }
    })
    this.channel.start()
    this.setProviderStatus('Connected to CAN bus')
    this.candevice = new CanDevice(this, this.options)
    this.candevice.start()

    // Recreate the no-data monitoring timer for this connection
    this._setupNoDataTimer()

    // Clear reconnecting flag on success
    this.reconnecting = false

    if (this.options.app) {
      console.log(`Successfully connected to ${canDevice}`)
    }

    return true
  } catch (e: any) {
    console.error(`unable to open canbus ${canDevice}: ${e}`)
    console.error(e.stack)
    this.setProviderError(e.message)

    // Clear reconnecting flag on failure
    this.reconnecting = false

    // Schedule retry after failure
    if (this.options.app) {
      console.error('Will retry connection in 5 seconds...')
    }
    setTimeout(() => {
      this.connect()
    }, 5000)

    return false
  }
}

util.inherits(CanbusStream, Transform)

CanbusStream.prototype.start = function () {}

CanbusStream.prototype.sendPGN = function (msg: any, force: boolean) {
  if (this.candevice) {
    //if ( !this.candevice.cansend && (_.isString(msg) || msg.pgn !== 59904) ) {
    if (!this.candevice.cansend && force !== true) {
      //we have not completed address claim yet
      return
    }

    this.debug('sending %j', msg)

    if (this.options.app) {
      this.options.app.emit('connectionwrite', {
        providerId: this.options.providerId
      })
    }

    const src =
      _.isString(msg) === false && (msg.pgn === 59904 || msg.forceSrc)
        ? msg.src
        : this.candevice.address
    if (_.isString(msg)) {
      const split = msg.split(',')
      split[3] = src
      msg = split.join(',')
    } else {
      msg.src = src
      if (_.isUndefined(msg.prio)) {
        msg.prio = 3
      }
      if (_.isUndefined(msg.dst)) {
        msg.dst = 255
      }
    }

    if (this.socketCanWriter) {
      if (_.isString(msg)) {
        this.socketCanWriter.stdin.write(msg + '\n')
      } else {
        const str = toActisenseSerialFormat(
          msg.pgn,
          toPgn(msg),
          msg.dst,
          msg.src
        )
        this.socketCanWriter.stdin.write(str + '\n')
      }
    } else if (this.channel) {
      let canid: number
      let buffer: Buffer | undefined
      let pgn: any

      if (_.isObject(msg)) {
        canid = encodeCanId(msg as CanID)
        buffer = toPgn(msg)
        pgn = msg
      } else {
        pgn = parseActisense(msg)
        canid = encodeCanId(pgn)
        buffer = pgn.data
      }

      if (this.debug.enabled) {
        const str = toActisenseSerialFormat(pgn.pgn, buffer, pgn.dst, pgn.src)
        this.debug(str)
      }

      if (buffer === undefined) {
        this.debug("can't convert %j", msg)
        return
      }

      //seems as though 126720 should always be encoded this way
      if (buffer.length > 8 || pgn.pgn == 126720) {
        const pgns = getPlainPGNs(buffer)
        pgns.forEach((pbuffer) => {
          this.channel.send({ id: canid, ext: true, data: pbuffer })
          if (this.options.app.listenerCount('canboatjs:rawsend') > 0) {
            this.options.app.emit('canboatjs:rawsend', {
              knownSrc: true,
              data: {
                pgn,
                length: pbuffer.length,
                data: byteStringArray(pbuffer)
              }
            })
          }
        })
      } else {
        this.channel.send({ id: canid, ext: true, data: buffer })
        if (this.options.app.listenerCount('canboatjs:rawsend') > 0) {
          this.options.app.emit('canboatjs:rawsend', {
            knownSrc: true,
            data: {
              pgn,
              length: buffer.length,
              data: byteStringArray(buffer)
            }
          })
        }
      }
    }
  }
}

CanbusStream.prototype._transform = function (
  chunk: any,
  encoding: any,
  done: any
) {
  done()
}

CanbusStream.prototype.end = function () {
  if (this.channel) {
    // Mark as intentional stop to prevent reconnection
    this.stoppingChannel = true
    const channel = this.channel
    delete this.channel
    try {
      channel.stop()
    } catch (e) {
      console.error('Error stopping channel in end():', e)
    }
  }
  if (this.noDataInterval) {
    clearInterval(this.noDataInterval)
    this.noDataInterval = null
  }
}

CanbusStream.prototype.pipe = function (pipeTo: any) {
  if (!pipeTo.fromPgn) {
    this.plainText = true
  }
  /*
  pipeTo.fromPgn.on('pgn', (pgn) => {
    if ( this.candevice ) {
      this.candevice.n2kMessage(pgn)
    }
  })
  */
  return (CanbusStream as any).super_.prototype.pipe.call(this, pipeTo)
}
