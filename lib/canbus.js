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

const debug = require('debug')('canboatjs:canbus')
const Transform = require('stream').Transform
const isArray = require('lodash').isArray
const BitStream = require('bit-buffer').BitStream
const BitView = require('bit-buffer').BitView
const { toPgn } = require('./toPgn')
const Parser = require('./fromPgn').Parser
const _ = require('lodash')
const CanDevice = require('./candevice')
const { getPlainPGNs } = require('./utilities')
const { encodeCanId, parseCanId } = require('./canId')
const { toActisenseSerialFormat, parseActisense } = require('./stringMsg')

const MSG_BUF_SIZE  			= 2000
const CANDUMP_DATA_INC_3		= 3
const CANDUMP_DATA_INC_2		= 2
const MAX_DATA_BYTES			= 223

// There are at least three variations in candump output
// format which are currently handled...
//
const FMT_TBD			= 0
const FMT_1			= 1	// Angstrom ex:	"<0x18eeff01> [8] 05 a0 be 1c 00 a0 a0 c0"
const FMT_2			= 2	// Debian ex:	"   can0  09F8027F   [8]  00 FC FF FF 00 00 FF FF"
const FMT_3			= 3	// candump log ex:	"(1502979132.106111) slcan0 09F50374#000A00FFFF00FFFF"


function CanbusStream (options) {
  if (!(this instanceof CanbusStream)) {
    return new CanbusStream(options)
  }

  Transform.call(this, {
    objectMode: true
  })

  this.plainText = false
  this.options = options
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
  
  if ( options.fromStdIn ) {
    return
  }

  try {
    this.socketcan = require('socketcan')
  } catch ( err ) {
    console.error(err)
    var msg = 'WARNING unable to load native socketcan interface'
    console.error(msg)
  }

  var that = this

  if ( options.app ) {
    options.app.on(options.outEvent || 'nmea2000out', (msg) => {
      that.sendPGN(msg)
    })
    options.app.on(options.jsonOutEvent || 'nmea2000JsonOut', (msg) => {
      that.sendPGN(msg)
    })
  }

  var canDevice = options.canDevice || 'can0'
  
  this.connect()

  const noDataReceivedTimeout = typeof options.noDataReceivedTimeout !== 'undefined' ? options.noDataReceivedTimeout : -1
  if ( noDataReceivedTimeout > 0 ) {
    this.noDataInterval = setInterval(() => {
      if ( this.channel && this.lastDataReceived && Date.now() - this.lastDataReceived > noDataReceivedTimeout * 1000 ) {
        let channel = this.channel
        delete this.channel
        try {
          channel.stop()
        } catch ( error ) {
        }
        this.setProviderError('No data received, retrying...')
        if ( this.options.app ) {
          console.error('No data received, retrying...')
        }
        this.connect()
      }
    }, noDataReceivedTimeout * 1000)
  }
}

CanbusStream.prototype.connect = function() {
  try {
    var that = this
    var canDevice = this.options.canDevice || 'can0'
    this.channel = this.socketcan.createRawChannelWithOptions(canDevice, { non_block_send: true} );
    this.channel.addListener('onStopped', (msg) => {
      if ( this.channel ) { // stoped by us?
        delete this.channel 
        this.setProviderError('Stopped, Retrying...')
        if ( this.options.app ) {
          console.error('socketcan stopped, retrying...')
        }
        setTimeout(() => {
          this.setProviderError('Reconnecting...')
          this.connect()
        }, 2000)
      }
    })
    this.channel.addListener('onMessage', (msg) => {
      var pgn = parseCanId(msg.id)

      if ( this.noDataInterval ) {
        this.lastDataReceived = Date.now()
      }

      //always send address claims through
      if ( pgn.pgn != 60928 && that.candevice && that.candevice.cansend && pgn.src == that.candevice.address ) {
        return
      }

      pgn.timestamp = new Date().toISOString()
      if ( that.plainText ) {
        this.push(binToActisense(pgn, msg.data, msg.data.length))
      } else {
        that.push({ pgn, length: msg.data.length, data: msg.data })
      }
    })
    this.channel.start()
    this.setProviderStatus('Connected to socketcan')
    this.candevice = new CanDevice(this, this.options)
    this.candevice.start()
  } catch (e) {
    console.error(`unable to open canbus ${canDevice}: ${e}`)
    console.error(e.stack)
    this.setProviderError(e.message)
  }
}

function binToActisense(pgn, data, length) {
  return (
    pgn.timestamp +
      `,${pgn.prio},${pgn.pgn},${pgn.src},${pgn.dst},${length},` +
      new Uint32Array(data)
      .reduce(function(acc, i) {
        acc.push(i.toString(16));
        return acc;
      }, [])
      .map(x => (x.length === 1 ? "0" + x : x))
      .join(",")
  );
}


require('util').inherits(CanbusStream, Transform)

CanbusStream.prototype.start = function () {
}

CanbusStream.prototype.sendPGN = function (msg, force) {
  if ( this.candevice ) {
    //if ( !this.candevice.cansend && (_.isString(msg) || msg.pgn !== 59904) ) {
    if ( !this.candevice.cansend && force !== true ) {
      //we have not completed address claim yet
      return
    }

    debug('sending %j', msg)

    if ( this.options.app ) {
      this.options.app.emit('connectionwrite', { providerId: this.options.providerId })
    }

    let src = msg.pgn === 59904 || msg.forceSrc ? msg.src : this.candevice.address
    if ( _.isString(msg) ) {
      var split = msg.split(',')
      split[3] = src
      msg = split.join(',')
    } else {
      msg.src = src
      if ( _.isUndefined(msg.prio) ) {
        msg.prio = 3
      }
      if ( _.isUndefined(msg.dst) ) {
        msg.dst = 255
      }
    }

    if ( this.socketCanWriter ) {
      if ( _.isString(msg) ) {
        this.socketCanWriter.stdin.write(msg + '\n')
      } else {
        var str = toActisenseSerialFormat(msg.pgn, toPgn(msg), msg.dst, msg.src)
        this.socketCanWriter.stdin.write(str + '\n')
      }
    } else if ( this.channel  ) {
      var canid
      var buffer

      var pgn
      if ( _.isObject(msg) ) {
        canid = encodeCanId(msg)
        buffer = toPgn(msg)
        pgn = msg
      } else {
        pgn = parseActisense(msg)
        canid = encodeCanId(pgn)
        buffer = pgn.data
      }

      if ( debug.enabled ) {
        var str = toActisenseSerialFormat(pgn.pgn, buffer, pgn.dst, pgn.src)
        debug(str)
      }

      //seems as though 126720 should always be encoded this way
      if ( buffer.length > 8 || pgn.pgn == 126720 ) {
        var pgns = getPlainPGNs(buffer)
        pgns.forEach(pbuffer => {
          this.channel.send({id: canid, ext:true, data: pbuffer})
        })
      } else {
        this.channel.send({id: canid, ext:true, data: buffer})
      }
    }
  }
}


CanbusStream.prototype._transform = function (chunk, encoding, done) {
  done()
}

CanbusStream.prototype.end = function () {
  if ( this.channel ) {
    let channel = this.channel
    delete this.channel
    channel.stop()
  }
  if ( this.noDataInterval ) {
    clearInterval(this.noDataInterval)
  }
}


CanbusStream.prototype.pipe = function (pipeTo) {
  if ( !pipeTo.fromPgn ) {
    this.plainText = true
  }
  /*
  pipeTo.fromPgn.on('pgn', (pgn) => {
    if ( this.candevice ) {
      this.candevice.n2kMessage(pgn)
    }
  })
  */
  return CanbusStream.super_.prototype.pipe.call(this, pipeTo)
}


module.exports = CanbusStream
