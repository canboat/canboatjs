/**
 * Copyright 2017 Scott Bender
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

  this.socketCanWriter = null
  var hasWriter = spawn('sh', ['-c', 'which socketcan-writer'])

  hasWriter.on('close', code => {
    if ( code == 0 ) {
      debug('found socketcan-writer, starting...')
      this.socketCanWriter = spawn('sh', ['-c', `socketcan-writer ${options.canDevice || 'can0'}`])
      
      this.socketCanWriter.stderr.on('data', function (data) {
        console.error(data.toString())
      })
      this.socketCanWriter.on('close', function (code) {
        console.error('socketcan-writer process exited with code ' + code)
        this.socketCanWriter = null
      })
      setTimeout(() => {
        this.candevice = new CanDevice(this, options)
      }, 5000)
    }
  })

  var that = this
  options.app.on('nmea2000out', (msg) => {
    that.sendPGN(msg)
  })
}

require('util').inherits(CanbusStream, Transform)

CanbusStream.prototype.start = function () {
}

CanbusStream.prototype.sendPGN = function (msg) {
  if ( this.socketCanWriter && this.candevice ) {
    debug(`nmea200Out: ${JSON.stringify(msg)}`)

    if ( _.isString(msg) ) {
      if ( this.candevice ) {
        var split = msg.split(',')
        split[3] = this.candevice.address
        msg = split.join(',')
      }
      this.socketCanWriter.stdin.write(msg + '\n')
    } else {
      msg.src = _.isUndefined(this.candevice) ? msg.src : this.candevice.address
      var str = toActisenseSerialFormat(msg.pgn, toPgn(msg), msg.dst, msg.src)
      debug(`converted ${str}`)
      this.socketCanWriter.stdin.write(str + '\n')
    }
  }
}

/*
CanbusStream.prototype.sendParsedPGN = function (pgn) {
  var buffer = toPgn(pgn)
  if ( buffer.length <= 8 ) {
    sendCanFrame(pgn, buffer)
  } else {
    sendFastPacket(pgn, buffer)
  }
}
*/

function sendCanFrame(pgn, buffer) {
  var canId = getCanIdFromISO11783Bits(pgn)

  /*
  var frame = new Buffer(8+buffer.length)
  var bitView = new VitView(buffer)
  var bs = new BitStream(bitView)
  

  bs.writeUint32(canId)
  bs.writeUint8(buffer.length)
  bs.writeUint8(0)
  bs.writeUint8(0)
  bs.writeUint8(0)
  
  buffer.copy(frame, bs.byteIndex)
  bs.byteIndex += buffer.length
  */

  //var idbuf = new Buffer(4)
  //buffer.writeUInt32(canId, 0)

  debug(`canid: ${canId}: '${canId.toString(16)}'`)
  debug(`buffer: ${buffer.toString('hex')}`)
  
  var command = `cansend ${canId.toString(16)}#${buffer.toString('hex')}`
  debug(`command: ${command}`)
  //var cansend = spawn('sh', ['-c', 'cansend'])
}

function getCanIdFromISO11783Bits(pgn)
{
  var buffer = new Buffer(10)
  var bv = new BitView(buffer)
  var bs = new BitStream(bv)

  bs.writeUint8(pgn.src)

  bs.writeUint8(pgn.dst)

  /*
  var canId = pgn.src | 0x80000000;  // src bits are the lowest ones of the CAN ID. Also set the highest bit to 1 as n2k uses only extended frames (EFF bit).

  if((pgn.pgn & 0xff) == 0) {  // PDU 1 (assumed if 8 lowest bits of the PGN are 0)
    canId += (pgn.dst << 8) & 0xff
    canId += (pgn.pgn << 8) & 0xff
    canId += pgn.prio << 26;
  } else {                       // PDU 2
    canId += (pgn.pgn << 8) & 0xff;
    canId += (pgn.prio << 26) & 0xff;
  }
*/

  return canId;
}


function getISO11783BitsFromCanId(id) {
  var res = {}
  var PF = (id >> 16) & 0xff
  var PS = (id >> 8) & 0xff
  var DP =  (id >> 24) & 1
  
  res.src = id >> 0 & 0xff
  res.prio = ((id >> 26) & 0x7)
  
  if (PF < 240) {
    /* PDU1 format, the PS contains the destination address */
    res.dst = PS;
    res.pgn = (DP << 16) + (PF << 8);
  } else {
    /* PDU2 format, the destination is implied global and the PGN is extended */
    res.dst = 0xff
    res.pgn = (DP << 16) + (PF << 8) + PS
  }
  return res
}

function readLine(that, line) {
  var candump_data_inc = CANDUMP_DATA_INC_3;
  
  if (line.length == 0 ) {
    return
  }
  
  if ( !that.format ) {
    that.s
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
  var pgn = getISO11783BitsFromCanId(canid)

  if ( that.candevice && pgn.src == that.candevice.address ) {
    //this is a message that we sent
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
  CanbusStream.super_.prototype.pipe.call(this, pipeTo)
}

module.exports = CanbusStream
