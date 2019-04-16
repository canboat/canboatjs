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

module.exports.getPlainPGNs = getPlainPGNs
module.exports.actisenseSerialToBuffer = actisenseSerialToBuffer
