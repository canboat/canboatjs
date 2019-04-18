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

const { keys, map, padCharsStart, trimChars } = require('lodash/fp')


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
exports.getPlainPGNs = getPlainPGNs

exports.trimWrap = trimChars('()<>[]')
exports.rmChecksum = str => str.includes('*') ? str.split('*', 1)[0] : str
exports.arrBuff = (arr, encoding = 'hex') => Buffer.from(arr.join(''), encoding)
exports.hexByte = x => padCharsStart('0', 2, Number(x).toString(16))
exports.byteString = (data, separator = ',') => (
  // Uint32Array map method doesn't work as expect. _.map does.
  map(exports.hexByte, new Uint32Array(data)).join(separator)
)
