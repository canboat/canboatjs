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
const {toPgn, toActisenseSerialFormat} = require('./toPgn')
const Parser = require('./fromPgn').Parser
const _ = require('lodash')
const CanDevice = require('./candevice')
const spawn = require('child_process').spawn
const { getPGNFromCanId, getCanIdFromPGN, actisenseSerialToBuffer } = require('./utilities')

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

  this.reconnect = options.reconnect || true
  this.options = options
  this.start()

  var socketcan;

  try {
    socketcan = require('socketcan')
  } catch ( err ) {
    console.log('WARNING: canboatjs: unable to load native socketcan interface')
  }

  var that = this

  if ( options.app ) {
    options.app.on('nmea2000out', (msg) => {
      that.sendPGN(msg)
    })
    options.app.on('nmea2000JsonOut', (msg) => {
      that.sendPGN(msg)
    })
  }

  var canDevice = options.canDevice || 'can0'
  if ( !socketcan || this.options.useSocketCanWriter ) {
    this.socketCanWriter = null
    var hasWriter = spawn('sh', ['-c', 'which socketcan-writer'])

    hasWriter.on('close', code => {
      if ( code == 0 ) {
        debug('found socketcan-writer, starting...')
        this.socketCanWriter = spawn('sh',
                                     ['-c', `socketcan-writer ${canDevice}`])
        
        this.socketCanWriter.stderr.on('data', function (data) {
          console.error(data.toString())
        })
        this.socketCanWriter.on('close', function (code) {
          console.error('socketcan-writer process exited with code ' + code)
          this.socketCanWriter = null
        })
        setTimeout(() => {
          this.candevice = new CanDevice(this, options)
          this.candevice.start()
        }, 5000)
      }
    })
  } else {
    try {
      this.channel = socketcan.createRawChannel(canDevice);
      this.channel.addListener('onMessage', (msg) => {
        var pgn = getPGNFromCanId(msg.id)
        
        if ( that.candevice && that.candevice.cansend && pgn.src == that.candevice.address ) {
          return
        }
        
        pgn.timestamp = new Date().toISOString()
        that.push({pgn: pgn, length: msg.data.length, data:msg.data})
      })
      this.channel.start()
      this.candevice = new CanDevice(this, options)
      this.candevice.start()
    } catch (e) {
      console.error(`unable to open canbus ${canDevice}: ${e}`)
    }
  }
}

require('util').inherits(CanbusStream, Transform)

CanbusStream.prototype.start = function () {
}

CanbusStream.prototype.sendPGN = function (msg) {
  if ( this.candevice ) {
    if ( !this.candevice.cansend && (_.isString(msg) || msg.pgn != 59904) ) {
      //we have not completed address claim yet
      return
    }

    debug('sending %j', msg)
    
    if ( _.isString(msg) ) {
      var split = msg.split(',')
      split[3] = this.candevice.address
      msg = split.join(',')
    } else {
      msg.src = this.candevice.address
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
        canid = getCanIdFromPGN(msg)
        buffer = toPgn(msg)
        pgn = msg
      } else {
        pgn = actisenseSerialToBuffer(msg)
        canid = getCanIdFromPGN(pgn)
        buffer = pgn.data
      }
      
      if ( buffer.length > 8 ) {
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

function getPlainPGNs(buffer) {
  var res = []
  var bucket = 0x40

  var first = new Buffer(8)
  first.writeUInt8(bucket++, 0)
  first.writeUInt8(buffer.length, 1)
  buffer.copy(first, 2, 0, 6)
  res.push(first)

  for ( var index = 6; index < buffer.length; index += 7 ) {
    var next = new Buffer(8)
    next.writeUInt8(bucket++, 0)
    var end = index+7
    var fill = 0
    if ( end > buffer.length ) {
      fill = end - buffer.length
      end = buffer.length
    }
    buffer.copy(next, 1, index, end)
    if ( fill > 0 ) {
      for ( var i = end-index; i < 8; i++ ) {
        next.writeUInt8(0xff, i)
      }
    }
    res.push(next)
  }
  return res
}

function readLine(that, line) {
  var candump_data_inc = CANDUMP_DATA_INC_3;
  
  if (line.length == 0 ) {
    return
  }
  
  if ( !that.format ) {
    //that.s
    if ( line.charAt(0) == '<' ) {
      that.format = FMT_1
    } else if ( line.charAt(0) == '(' ) {
      that.format = FMT_3
      console.error("candump format not supported")
    } else {
      that.format = FMT_2
    }
  }


  var canid
  var data
  var split = line.trim().split(' ').filter(s => s.length > 0)
  var len
  if ( that.format === FMT_3 ) {
    return
  } else if ( that.format === FMT_1 ) {
    canid = parseInt(split[0].substring(1, split[0].length-1), 16)
    data = split.slice(2)
    len = split[1].substring(1, split[1].length-1)
  } else if ( that.format === FMT_2 ) {
    canid = parseInt(split[1], 16)
    data = split.slice(3)
    len = split[2].substring(1, split[2].length-1)
  }

  //console.log(JSON.stringify(split))
  var pgn = getPGNFromCanId(canid)

  if ( that.candevice && pgn.src == that.candevice.address ) {
    //this is a message that we sent
    debug('got a message from me')
    return
  }
  
  pgn.timestamp = new Date().toISOString()

  that.push({pgn: pgn, length: len, data:data})
}

CanbusStream.prototype._transform = function (chunk, encoding, done) {
  readLine(this, chunk.toString())
  done()
}

CanbusStream.prototype.end = function () {
  if ( this.socketCanWriter ) {
    debug('end, killing socketcan-writer process')
    this.socketCanWriter.kill()
   }
}

CanbusStream.prototype.pipe = function (pipeTo) {
  pipeTo.fromPgn.on('pgn', (pgn) => {
    if ( this.candevice ) {
      this.candevice.n2kMessage(pgn)
    }
  })
  return CanbusStream.super_.prototype.pipe.call(this, pipeTo)
}

module.exports = CanbusStream
