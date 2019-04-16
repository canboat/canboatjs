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

const _ = require('lodash')

function getPGNFromCanId(id) {
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

function getCanIdFromPGN(pgn)
{
  var canId = pgn.src | 0x80000000;  // src bits are the lowest ones of the CAN ID. Also set the highest bit to 1 as n2k uses only extended frames (EFF bit).

  if((pgn.pgn & 0xff) == 0) {  // PDU 1 (assumed if 8 lowest bits of the PGN are 0)
    canId += (pgn.dst << 8)
    canId += (pgn.pgn << 8)
    canId += pgn.prio << 26;
  } else {                       // PDU 2
    canId += pgn.pgn << 8;
    canId += pgn.prio << 26;
  }

  return canId;
}

//used for the YDGW-02
function getCanIdFromYdgwPGN(pgn)
{
  var canId = pgn.src | 0x0000000;  // src bits are the lowest ones of the CAN ID. Also set the highest bit to 1 as n2k uses only extended frames (EFF bit).

  if((pgn.pgn & 0xff) == 0) {  // PDU 1 (assumed if 8 lowest bits of the PGN are 0)
    canId += (pgn.dst << 8)
    canId += (pgn.pgn << 8)
    canId += pgn.prio << 26;
  } else {                       // PDU 2
    canId += pgn.pgn << 8;
    canId += pgn.prio << 26;
  }

  return canId;
}

const mainFields = [
  'timestamp',
  'prio',
  'pgn',
  'src',
  'dst'
]

function actisenseSerialToBuffer(string) {
  var split = string.split(',')

  var pgn = {}

  mainFields.forEach((key, index) => {
    var val = split[index]
    pgn[key] = key === 'timestamp' ? val : Number(val)
  })

  var len = Number(split[5])
  var array = new Int16Array(len)
  for ( var i = 6; i < (len+6); i++ ) {
    array[i-6] = parseInt(split[i], 16)
  }
  pgn.data = new Buffer(array)
  return pgn
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

module.exports.getCanIdFromPGN = getCanIdFromPGN
module.exports.getCanIdFromYdgwPGN = getCanIdFromYdgwPGN
module.exports.getPGNFromCanId = getPGNFromCanId
module.exports.actisenseSerialToBuffer = actisenseSerialToBuffer
