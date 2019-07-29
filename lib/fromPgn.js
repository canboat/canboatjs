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

const debug = require('debug')('canboatjs:fromPgn')
const trace = require('debug')('canboatjs:fromPgn:trace')
const EventEmitter = require('events')
const pkg = require('../package.json')
const _ = require('lodash')
const { pgns } = require('./pgns')
const BitStream = require('bit-buffer').BitStream
const BitView = require('bit-buffer').BitView
const Int64LE = require('int64-buffer').Int64LE
const Uint64LE = require('int64-buffer').Uint64LE
const { parse: parseDate } = require('date-fns')

const { getPGNFromCanId } = require('./utilities')
const { getIndustryName, getManufacturerName } = require('./codes')
const { parseCanId } = require('./canId')
const { parseN2kString, parseYDRAW, isN2KOver0183, parseN2KOver0183 } = require('./stringMsg')

var fieldTypeReaders = {}
var fieldTypePostProcessors = {}

const timeUnitsPerSecond = 10000
const maxUint64 = new Int64LE(0xffffffff, 0xffffffff)
const maxInt64 = new Int64LE(0x7fffffff, 0xffffffff)

const FORMAT_PLAIN = 0
const FORMAT_FAST  = 1

const FASTPACKET_INDEX = 0
const FASTPACKET_SIZE = 1
const FASTPACKET_BUCKET_0_SIZE = 6
const FASTPACKET_BUCKET_N_SIZE = 7
const FASTPACKET_BUCKET_0_OFFSET = 2
const FASTPACKET_BUCKET_N_OFFSET = 1
const FASTPACKET_MAX_INDEX = 0x1f
const FASTPACKET_MAX_SIZE = (FASTPACKET_BUCKET_0_SIZE + FASTPACKET_BUCKET_N_SIZE * (FASTPACKET_MAX_INDEX - 1))


//we can't handle these, so ignore them
const ignoredPgns = []//130820, 126720 ]

class Parser extends EventEmitter {
  constructor (opts) {
    super()
    this.options = _.isUndefined(opts) ? {} : opts

    this.name = pkg.name
    this.version = pkg.version
    this.author = pkg.author
    this.license = pkg.license
    this.format = _.isUndefined(this.options.format) ? -1 : this.options.format
    this.devices = {}
    this.mixedFormat = this.options.mixedFormat || false
  }

  _parse(pgn, bs, len, cb) {
    if ( ignoredPgns.indexOf(pgn.pgn) != -1 ) {
      this.emit('warning', pgn, 'ignoring pgn')
      return  undefined
    }

    let pgnList = pgns[pgn.pgn]
    if (!pgnList) {
      this.emit('warning', pgn, `no conversion found for pgn ${JSON.stringify(pgn)}`)
      return undefined
    }

    let pgnData = pgnList[0]
    let couldBeMulti = false;

    if ( pgnList.length > 0 && len == 8 ) {
      pgnList.forEach(pgnD => {
        if ( pgnD.Length > 8 ) {
          couldBeMulti = true
        }
      })
    }

    trace(`${len} ${pgnData.Length} ${pgnData.RepeatingFields} ${couldBeMulti}`)
    if ( len > 0x8 || (this.format == FORMAT_FAST && !this.mixedFormat) ) {
      this.format = FORMAT_FAST
    } else if ( pgnData.Length > 0x8 || (len == 0x8 && (pgnData.RepeatingFields || couldBeMulti))) {
      //partial packet
      this.format = FORMAT_PLAIN

      if (  _.isUndefined(this.devices[pgn.src]) ) {
        this.devices[pgn.src] = {}
      }
      var packet = this.devices[pgn.src][pgn.pgn]

      if ( !packet ) {
        packet = { bufferSize:0, lastPacket: 0 }
        this.devices[pgn.src][pgn.pgn] = packet
      }

      var start = bs.byteIndex
      var packetIndex = bs.view.buffer.readUInt8(FASTPACKET_INDEX)
      var bucket = packetIndex & FASTPACKET_MAX_INDEX;
      var maybeBad = false

      trace(`partial ${packetIndex} ${bucket} ${packet.size}`)

      if ( bucket == 0 ) {
        packet.size = bs.view.buffer.readUInt8(FASTPACKET_SIZE)
        var newSize = packet.size  + FASTPACKET_BUCKET_N_SIZE;
        if ( newSize > packet.bufferSize ) {
          var newBuf = new Buffer(newSize)
          packet.bufferSize = newSize
          if ( packet.buffer ) {
            packet.buffer.copy(newBuf)
          }
          packet.buffer = newBuf
        }
        bs.view.buffer.copy(packet.buffer, 0, FASTPACKET_BUCKET_0_OFFSET, 8)
        trace(`targetStart: 0 sourceStart: ${FASTPACKET_BUCKET_0_OFFSET}`)
      } else {
        if (packet.lastPacket + 1 != packetIndex) {
          debug(`PGN ${pgn.pgn} malformed packet for ${pgn.src} received; expected ${packet.lastPacket+1} but got ${packetIndex}`)
          cb && cb(`Could not parse ${JSON.stringify(pgn)}`)
          bs.byteIndex = start
          maybeBad = true
        } else {
          trace(`targetStart: ${FASTPACKET_BUCKET_0_SIZE + FASTPACKET_BUCKET_N_SIZE * (bucket-1)} sourceStart: ${FASTPACKET_BUCKET_N_OFFSET} sourceEned: ${FASTPACKET_BUCKET_N_SIZE}`)
          bs.view.buffer.copy(
            packet.buffer,
            FASTPACKET_BUCKET_0_SIZE + FASTPACKET_BUCKET_N_SIZE * (bucket-1)
            , FASTPACKET_BUCKET_N_OFFSET, 8
          )
        }
      }
      if ( !maybeBad ) {
        packet.lastPacket = packetIndex;
        if (FASTPACKET_BUCKET_0_SIZE + FASTPACKET_BUCKET_N_SIZE * bucket < packet.size)
        {
          // Packet is not complete yet
          trace('not complete')
          return;
        }
        var view = new BitView(packet.buffer)
        bs = new BitStream(view)
        trace('done')
      }
    }

    pgn.fields = {}
    try {
      var fields = pgnData.Fields

      for ( var i = 0; i < fields.length-pgnData.RepeatingFields; i++ ) {
        var field = fields[i]
        var hasMatch = !_.isUndefined(field.Match)

        var value = readField(this.options, !hasMatch, pgn, field, bs)

        if ( hasMatch ) {
          //console.log(`looking for ${field.Name} == ${value}`)
          //console.log(JSON.stringify(pgnList, null, 2))
          pgnList = pgnList.filter(f => f.Fields[i].Match == value)
          if ( pgnList.length == 0 ) {
            //this.emit('warning', pgn, `no conversion found for pgn`)
            trace('warning no conversion found for pgn %j', pgn)
            return
          }
          pgnData = pgnList[0]
          fields = pgnData.Fields
          //console.log(`using ${JSON.stringify(pgnData, null, 2)}`)
          value = pgnData.Fields[i].Description
        }

        if ( !_.isUndefined(value) && value != null ) {
          pgn.fields[field.Name] = value
        }
      }
      if ( pgnData.RepeatingFields > 0 ) {
        var repeating = fields.slice(fields.length-pgnData.RepeatingFields)
        pgn.fields.list = []

        while ( bs.bitsLeft > 0 ) {
          var group = {}
          repeating.forEach(field => {
            if ( bs.bitsLeft > 0 ) {
              var value = readField(this.options, true, pgn, field, bs)
              if ( !_.isUndefined(value) && value != null ) {
                group[field.Name] = value
              }
            }
          })
          if ( _.keys(group).length > 0 ) {
            pgn.fields.list.push(group)
          }
        }
      }

      pgn.description = pgnData.Description

      //console.log(`pgn: ${JSON.stringify(pgn)}`)

      // Stringify timestamp because SK Server needs it that way.
      const ts = _.get(pgn, 'timestamp', new Date())
      pgn.timestamp = _.isDate(ts) ? ts.toISOString() : ts
      this.emit('pgn', pgn)
      cb && cb(undefined, pgn)
      return pgn
    } catch ( error ) {
      this.emit('error', pgn, error)
      cb && cb(error)
      return
    }
  }

  parse(data, cb) {
    if (_.isString(data) ) {
      return this.parseString(data, cb)
    } else if ( _.isBuffer(data) ) {
      return this.parseBuffer(data, cb)
    } else {
      return this.parsePgnData(data.pgn, data.length, data.data, cb)
    }
  }

  parsePgnData(pgn, length, data, cb) {
    try
    {
      var buffer = data
      if ( !_.isBuffer(data) )  {
        var array = new Int16Array(length)
        data.forEach((num, index) => {
          array[index] = parseInt(num, 16)
        })
        buffer = new Buffer(array)
      }

      var bv = new BitView(buffer);
      var bs = new BitStream(bv)
      const res = this._parse(pgn, bs, length, cb);
      if ( res ) {
        debug('parsed pgn %j', pgn)
      }
      return res
    } catch ( error ) {
      cb && cb(error)
      this.emit('error', pgn, error)
    }
  }

  isN2KOver0183(sentence) {
    return isN2KOver0183(sentence)
  }

  parseN2KOver0183(sentence, cb) {
    return this.parseString(sentence, cb)
  }

  // Venus MQTT-N2K
  parseVenusMQTT(pgn_data, cb) {
    try
    {
      const pgn = {
        pgn: pgn_data.pgn,
        timestamp: new Date().toISOString(),
        src: pgn_data.src,
        dst: pgn_data.dst
      }
      const bs = new BitStream(Buffer.from(pgn_data.data, 'base64'))
      const res = this._parse(pgn, bs, 8, cb)
      if ( res ) {
        debug('parsed pgn %j', pgn)
      }
      return res
    } catch ( error ) {
      cb && cb(error)
      this.emit('error', pgn, error)
    }
  }

  //Yacht Devices NMEA2000 Wifi gateway
  parseYDGW02(pgn_data, cb) {
    try {
      const { data, direction, error, ...pgn } = parseYDRAW(pgn_data)
      if (!error && direction === 'R') {
        const bs = new BitStream(data)
        delete pgn.format
        const res = this._parse(pgn, bs, data.length, cb)
        if ( res ) {
          debug('parsed ydgw02 pgn %j', pgn)
          return res
        }
      } else if ( error ) {
        cb && cb(error)
        this.emit('error', pgn, error)
      }
    } catch ( error ) {
      cb && cb(error)
      this.emit('error', pgn, error)
    }
    return undefined
  }

  parseString (pgn_data, cb) {
    try {
      const { data, error, len, ...pgn } = parseN2kString(pgn_data)
      if (error) {
        cb && cb(error)
        this.emit('error', pgn, error)
        return
      }

      const bs = new BitStream(data)
      delete pgn.format
      delete pgn.type
      delete pgn.prefix
      const res = this._parse(pgn, bs, len || data.length, cb)
      if (res) {
        debug('parsed pgn %j', pgn)
      }
      return res
    } catch ( error ) {
      cb && cb(error)
      this.emit('error', pgn_data, error)
    }
  }

  // What uses this? What created the buffer?
  parseBuffer (pgn_data, cb) {
    try {
      var bv = new BitView(pgn_data);
      var bs = new BitStream(bv)

      var pgn = {}

      // This might be good to move to canId.js ?
      pgn.prio = bs.readUint8()
      pgn.pgn = bs.readUint8() + 256 * (bs.readUint8() + 256 * bs.readUint8());
      pgn.dst = bs.readUint8()
      pgn.src = bs.readUint8()
      pgn.timestamp = new Date().toISOString()

      var timestamp = bs.readUint32()
      var len = bs.readUint8()
      const res = this._parse(pgn, bs, len, cb)
      if ( res ) {
        debug('parsed pgn %j', pgn)
      }
      return res
    } catch ( error ) {
      const err = new Error(`error reading pgn ${JSON.stringify(pgn)} ${error}`)
      cb && cb(err)
      this.emit('error', pgn, error)
      console.error(err)
      return
    }
  }

}

function getField(pgn, index) {
  var pgnList = pgns[pgn]
  if ( pgnList ) {
    var pgn = pgnList[0]

    if ( index < pgn.Fields.length ) {
      return pgn.Fields[index]
    }

    if ( pgn.RepeatingFields ) {
      var startOfRepeatingFields = pgn.Fields.length - pgn.RepeatingFields
      index = startOfRepeatingFields + ((index - startOfRepeatingFields) % pgn.RepeatingFields);
      return pgn.Fields[index]
    }
  }
  return null;
}

function pad2(x) {
  x = x.toString()
  return x.length === 1 ? "0" + x : x
}

function pad(n, p, c)
{
  n = n.toString()
  var pad_char = typeof c !== 'undefined' ? c : '0';
  var pad = new Array(1 + p).join(pad_char);
  return (pad + n).slice(-pad.length);
}

function lookup(field, value) {
  if (!field.value2name) {
    field.value2name = {};
    field.EnumValues.forEach(function(enumPair) {
      field.value2name[Number(enumPair.value)] = enumPair.name
    })
  }
  var name = field.value2name[value]
  return name ? name : value
  //return name
}

function lookupBitField(field, value) {
  if (!field.value2name) {
    field.value2name = {};
    field.EnumBitValues.forEach(function(enumPair) {
      var key = _.keys(enumPair)[0]
      field.value2name[Number(key)] = enumPair[key]
    })
  }
  return (field.value2name[value]);
}

function readField(options, runPostProcessor, pgn, field, bs) {
  var value

  var reader = fieldTypeReaders[field.Type]
  if ( reader ) {
    value = reader(pgn, field, bs)
  } else {
    if ( bs.bitsLeft < field.BitLength ) {
      //no more data
      bs.readBits(bs.bitsLeft, false)
      return
    }
    value = readValue(pgn, field, bs)
  }

  //console.log(`${field.Name} ${value} ${field.Resolution}`)

  if ( value != null && !_.isUndefined(value) ) {
    var postProcessor = fieldTypePostProcessors[field.Type]
    if ( postProcessor ) {
      if ( runPostProcessor ) {
        value = postProcessor(field, value)
      }
    } else {
      if ( field.Offset ) {
        value += field.Offset
      }
      if ( field.Resolution ) {
        var resolution = field.Resolution

        value = (value * resolution)

        if ( resolution === 3.125e-8 ) {
          //yes. hack.
          resolution = "0.0000000001"
        }

        if ( _.isString(resolution) &&
             resolution.indexOf('.') != -1 ) {
          value = Number.parseFloat(value.toFixed(resolution.length-2))
        }
      }

      if (field.EnumValues &&
          (_.isUndefined(options.resolveEnums) ||
           options.resolveEnums)) {
        if (field.Id === "timeStamp" && value < 60) {
          value = value.toString()
        } else {
          value = lookup(field, value)
        }
      }

      if ( field.Name === 'Industry Code' && _.isNumber(value) && runPostProcessor ) {
        var name = getIndustryName(value)
        if ( name ) {
          value = name
        }
      }

      if ( field.Units === "kWh" ) {
        value *= 3.6e6; // 1 kWh = 3.6 MJ.
      } else if (field.Units === "Ah") {
        value *= 3600.0; // 1 Ah = 3600 C.
      }
    }
  }
  return value
}

function readValue(pgn, field, bs, bitLength) {
  var value
  if ( _.isUndefined(bitLength) ) {
    bitLength = field.BitLength
  }
  if ( bitLength == 0 ) {
    value = readVariableLengthField(pgn, field, bs)
  } else if (bitLength === 8) {
    if ( field.Signed ) {
      value = bs.readInt8()
      value = value === 0x7f ? null : value
    } else {
      value = bs.readUint8()
      value = value === 0xff ? null : value
    }
  } else if ( bitLength == 16 ) {
    if ( field.Signed ) {
      value = bs.readInt16()
      value = value === 0x7fff ? null : value
    } else {
      value = bs.readUint16()
      value = value === 0xffff ? null : value
    }
  } else if ( bitLength == 24 ) {
    var b1 = bs.readUint8()
    var b2 = bs.readUint8()
    var b3 = bs.readUint8()

    //debug(`24 bit ${b1.toString(16)} ${b2.toString(16)} ${b3.toString(16)}`)
    value = (b3 << 16)  + (b2 << 8)  + (b1)
    //debug(`value ${value.toString(16)}`)
  } else if ( bitLength == 32 ) {
    if ( field.Signed ) {
      value = bs.readInt32()
      value = value === 0x7fffffff ? null : value
    } else {
      value = bs.readUint32()
      value = value === 0xffffffff ? null : value
    }
  } else if ( bitLength == 48 ) {
    var a = bs.readUint32()
    var b = bs.readUint16()

    if ( field.Signed ) {
      value =  a == 0xffffffff && b == 0x7fff ? null : new Int64LE(b, a)
    } else {
      value =  a == 0xffffffff && b == 0xffff ? null : new Int64LE(b, a)
    }
  } else if ( bitLength == 64 ) {
    var x = bs.readUint32()
    var y = bs.readUint32()

    if ( field.Signed ) {
      value = x === 0xffffffff && y == 0x7fffffff ? null : new Int64LE(y,x)
    } else {
      value = x === 0xffffffff && y == 0xffffffff ? null : new Uint64LE(y,x)
    }
  } else {
    value = bs.readBits(bitLength, field.Signed)
    if ( bitLength > 1 && isMax(bitLength, value, field.Signed) ) {
      value = null
    }
    //console.log(`${field.Name} ${bitLength} ${value} ${bs.view.buffer[bs.byteIndex]} ${bs.index}`)
  }

  return value
}

function isMax(numBits, value, signed)
{
  if ( signed ) {
    numBits--
  }

  while ( numBits-- ) {
    if ( (value & 1) == 0 ){
      return false
    }
    value = value >> 1
  }
  return signed ? (value & 1) == 0 : true
}

function readVariableLengthField(pgn, field, bs) {
  /* PGN 126208 contains variable field length.
   * The field length can be derived from the PGN mentioned earlier in the message,
   * plus the field number.
   */

  /*
   * This is rather hacky. We know that the 'data' pointer points to the n-th variable field
   * length and thus that the field number is exactly one byte earlier.
   */

  var refField = getField(pgn.fields.PGN, bs.view.buffer[bs.byteIndex-1]-1)

  if ( refField ) {
    var bits = (refField.BitLength + 7) & ~7; // Round # of bits in field refField up to complete bytes: 1->8, 7->8, 8->8 etc.
    return readValue(pgn, refField, bs, bits)
  }
}

fieldTypeReaders['ASCII or UNICODE string starting with length and control byte'] = (pgn, field, bs) => {

  if ( bs.bitsLeft >= 16 ) {
    const len = bs.readUint8()-2
    const control = bs.readUint8()
    let nameLen = len

    if ( field.Name === 'AtoN Name' && len > 20 ) {
      nameLen = 20
    } else if ( len <= 0 ) {
      return null
    }

    var buf = new Buffer(len)
    var idx = 0
    for ( ; idx < len && bs.bitsLeft >= 8; idx++ ) {
      var c = bs.readUint8()
      buf.writeUInt8(c, idx)
    }

    return buf.toString(control == 0 ? 'utf8' : 'ascii', 0, idx < nameLen ? idx : nameLen).trim()
  } else {
    return null
  }
}

fieldTypeReaders['ASCII string starting with length byte'] = (pgn, field, bs) => {
  var len = bs.readUint8()

  var buf = new Buffer(len)
  var idx = 0
  for ( ; idx < len && bs.bitsLeft >= 8; idx++ ) {
    var c = bs.readUint8()
    buf.writeUInt8(c, idx)
  }

  return buf.toString('ascii', 0, idx)
}

fieldTypeReaders["String with start/stop byte"] = (pgn, field, bs) => {
  var len
  var first = bs.readUint8()
  if ( first == 0x02 ) {
    var buf = new Buffer(255)
    var c
    var idx = 0
    while ( (c = bs.readUint8()) != 0x01 ) {
      buf.writeUInt8(c, idx++)
    }
    return buf.toString('ascii', 0, idx)
  } else if ( first > 0x02 ) {
    var len = first
    var second = bs.readUint8()
    var buf = new Buffer(len)
    var idx = 0
    if ( second == 0x01 ) {
      len -= 2
    } else {
      buf.writeUInt8(second)
      idx = 1
    }
    for ( ; idx < len; idx++ ) {
      var c = bs.readUint8()
      buf.writeUInt8(c, idx)
    }
    return buf.toString('ascii', 0, idx)
  }
}

fieldTypeReaders['ASCII text'] = (pgn, field, bs) => {
  var len = field.BitLength / 8
  var buf = new Buffer(len)

  for ( var i = 0; i < len && bs.bitsLeft >= 8; i++ ) {
    buf.writeUInt8(bs.readUint8(), i)
  }

  var lastbyte = buf[len-1]
  if (lastbyte == 0xff ||
      lastbyte == 32 ||
      lastbyte == 0 ||
      lastbyte == 64
     )
  {
    while (len > 0 && (buf[len - 1] == lastbyte))
    {
      len--;
    }
  }
  return buf.toString('ascii', 0, len)
}

fieldTypeReaders['Bitfield'] = (pgn, field, bs) => {
  var value = []
  for ( var i = 0; i < field.BitLength; i++ ) {
    if ( bs.readBits(1, 0) ) {
      value.push(lookupBitField(field, i))
    }
  }
  return value
}

fieldTypePostProcessors['Date'] = (field, value) => {
  if ( value >= 0xfffd ) {
    value = undefined
  } else {
    var date = new Date((value) * 86400 * 1000)
    //var date = moment.unix(0).add(value+1, 'days').utc().toDate()
    value = `${date.getUTCFullYear()}.${pad2(date.getUTCMonth()+1)}.${pad2(date.getUTCDate())}`
  }
  return value
}

fieldTypePostProcessors['Time'] = (field, value) => {
  if (value >= 0xfffffffd) {
    value = undefined
  } else {
    var seconds = (value / timeUnitsPerSecond)
    //var units = value % timeUnitsPerSecond;
    var minutes = (seconds / 60);
    var seconds = seconds % 60;
    var hours = Math.floor(minutes / 60);
    var minutes = Math.floor(minutes % 60);

    value = `${pad2(hours)}:${pad2(minutes)}:${pad2(Math.floor(seconds))}`

    if ( seconds % 1 > 0 ) {
      value = value + (seconds%1).toFixed(5).substring(1)
    }
  }
  return value
}

fieldTypePostProcessors['Pressure'] = (field, value) => {
  if (field.Units)
  {
    switch (field.Units[0]) {
    case 'h':
    case 'H':
      value *= 100;
      break;
    case 'k':
    case 'K':
      value *= 1000;
      break;
    case 'd':
      value /= 10;
      break;
    }
  }
  return value
}

fieldTypePostProcessors['Binary data'] = (field, value) => {
  return value.toString()
}

fieldTypePostProcessors['Manufacturer code'] = (field, value) => {
  var manufacturer = getManufacturerName(value)
  return manufacturer ? manufacturer : value
}

module.exports = {
  Parser: Parser,
  getField: getField,
}
