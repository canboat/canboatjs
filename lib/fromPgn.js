'use strict'

/**
 * Copyright 2016 Signal K and Fabian Tollenaar <fabian@signalk.org>.
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

const debug = require('debug')('signalk-n2k-analyzer')
const EventEmitter = require('events')
const pkg = require('../package.json')
const _ = require('lodash')
const pgns = require('./pgns')
const BitStream = require('bit-buffer').BitStream
const BitView = require('bit-buffer').BitView
const Int64LE = require('int64-buffer').Int64LE
const Uint64LE = require('int64-buffer').Uint64LE

var fieldTypeRaeaders = {}
var fieldTypePostProcessors = {}

const mainFields = [
  'timestamp',
  'prio',
  'pgn',
  'src',
  'dst'
]

const timeUnitsPerSecond = 10000

//we can't handle these, so ignore them
const ignoredPgns = [130820, 126720 ]

class Parser extends EventEmitter {
  constructor (opts) {
    super()
    this.options = _.isUndefined(opts) ? {} : opts

    this.name = pkg.name
    this.version = pkg.version
    this.author = pkg.author
    this.license = pkg.license
  }

  parse(pgn, bs) {
    if ( ignoredPgns.indexOf(pgn.pgn) != -1 ) {
      this.emit('warning', pgn, 'ignoring pgn')
      return 
    }
    
    const pgnData = pgns.PGNs[pgn.pgn]
    if (!pgnData) {
      this.emit('warning', pgn, `no conversion found for pgn`)
      return null
    }

    pgn.description = pgnData.Description
    pgn.fields = {}
    try {
      var fields = pgnData.Fields
      if ( !_.isArray(fields) ) {
        fields = [ fields ]
      }
      
      fields.forEach(field => {
        var value

        var reader = fieldTypeRaeaders[field.Type]
        if ( reader ) {
          value = reader(pgn, field, bs)
        } else {
          if ( bs.bitsLeft < field.BitLength ) {
            //no more data
            return
          }
          value = readValue(field, bs)
        }

        if ( field.Name === 'Reserved' ) {
          return
        }

        //console.log(`${field.Name} ${value} ${field.Resolution}`)

        if ( value != null && !_.isUndefined(value) ) {
          var postProcessor = fieldTypePostProcessors[field.Type]
          if ( postProcessor ) {
            value = postProcessor(field, value)
          } else {
            if ( field.Resolution ) {
              var resolution = field.Resolution
              
              value = (value * resolution)

              if ( resolution === 3.125e-8 ) {
                //yes. hack.
                resolution = "0.000000001"
                value = value / 10
              } 

              if ( _.isString(resolution) &&
                   resolution.indexOf('.') != -1 ) {
                value = Number.parseFloat(value.toFixed(resolution.length-2))
              } 
            }
            
            if (field.EnumValues &&
                (_.isUndefined(this.options.resolveEnums) ||
                 this.options.resolveEnums)) {
              if (!(field.Id === "timeStamp" && value < 60)) {
                value = lookup(field, value)
              }
            }
          }

          pgn.fields[field.Name] = value
        }
      })
      //console.log(`pgn: ${JSON.stringify(pgn)}`)

      this.emit('pgn', pgn)
    } catch ( error ) {
      this.emit('error', pgn, error)
    }
  }

  parseString (pgn_data) {
    if (typeof pgn_data === 'string' && pgn_data.trim().length > 0) {
      this.emit('N2KAnalyzerOut', pgn_data.trim())

      
      var split = pgn_data.split(',')

      var pgn = {}

      mainFields.forEach((key, index) => {
        var val = split[index]
        pgn[key] = key === 'timestamp' ? val : Number(val)
      })

      var len = Number(split[5])
      var array = new Int16Array(len)
      for ( var i = 6; i < (len+6); i++ ) {
        array[i-6] = parseInt('0x' + split[i], 16)
      }
      var buffer = new Buffer(array)
      var bv = new BitView(buffer);
      var bs = new BitStream(bv)
      this.parse(pgn, bs)
    }
  }
  
  parseBuffer (pgn_data) {
    //this.emit('N2KAnalyzerOut', pgn_data.trim())

    var bv = new BitView(pgn_data);
    var bs = new BitStream(bv)

    var pgn = {}

    pgn.prio = bs.readUint8()
    pgn.pgn = bs.readUint8() + 256 * (bs.readUint8() + 256 * bs.readUint8());
    pgn.dst = bs.readUint8()
    pgn.src = bs.readUint8()
    pgn.timestamp = new Date().toISOString()

    var timestamp = bs.readUint32()
    var len = bs.readUint8()
    this.parse(pgn, bs)
  }

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
  return (field.value2name[value]);
}

function lookupBitField(field, value) {
  if (!field.value2name) {
    field.value2name = {};
    field.EnumBitValues.forEach(function(enumPair) {
      var key = _.keys(enumPair)[0]
      field.value2name[Number(key)] = enumPair[key]
    })
    console.log(`lookupBitField ${JSON.stringify(field.value2name)}`)
  }
  return (field.value2name[value]);
}

function readValue(field, bs) {
  var value
  if (field.BitLength === 8) {
    if ( field.Signed ) {
      value = bs.readInt8()
      value = value === 0x7f ? null : value
    } else {
      value = bs.readUint8()
      value = value === 0xff ? null : value
    }
  } else if ( field.BitLength == 16 ) {
    if ( field.Signed ) {
      value = bs.readInt16()
      value = value === 0x7fff ? null : value
    } else {
      value = bs.readUint16()
      value = value === 0xffff ? null : value
    }
  } else if ( field.BitLength == 32 ) {
    if ( field.Signed ) {
      value = bs.readInt32()
      value = value === 0x7fffffff ? null : value
    } else {
      value = bs.readUint32()
      value = value === 0xffffffff ? null : value
    }
  } else if ( field.BitLength == 64 ) {
    var x = bs.readUint32()
    var y = bs.readUint32()
    
    if ( field.Signed ) {
      value = new Int64LE(y,x)
      value = value === 0x7fffffffffffffffffffffff ? null : value
    } else {
      value = new Uint64LE(y,x)
      value = value === 0xffffffffffffffffffffffff ? null : value
    }
  } else {
    value = bs.readBits(field.BitLength, field.Signed)
  }
  return value
}

fieldTypeRaeaders["String with start/stop byte"] = (pgn, field, bs) => {
  var len
  var first = bs.readUint8()
  if ( first == 0x02 ) {
    var buf = new Buffer(255)
    var c
    var idx = 0
    while ( (c = bs.readUint8()) != 0x01 ) {
      buf.writeUInt8(c, idx++)
    }
    return buf.toString('utf8', 0, idx)
  } else if ( first > 0x02 ) {
    var len = first
    var second = bs.readUint8()
    var buf = new Buffer(255)
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
    return buf.toString('utf8', 0, idx)
  }
}

fieldTypeRaeaders['ASCII text'] = (pgn, field, bs) => {
  var len = field.BitLength / 8
  var buf = new Buffer(len)

  for ( var i = 0; i < len; i++ ) {
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
  return buf.toString('utf8', 0, len)
}

fieldTypeRaeaders['Bitfield'] = (pgn, field, bs) => {
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
    var date = new Date(value * 86400 * 1000)
    value = `${1900 + date.getYear()}.${pad2(date.getMonth()+1)}.${pad2(date.getDate()+1)}`
  }
  return value
}

fieldTypePostProcessors['Time'] = (field, value) => {
  if (value >= 0xfffffffd) {
    value = undefined
  } else {
    var seconds = (value / timeUnitsPerSecond)
    var units = value % timeUnitsPerSecond;
    var minutes = (seconds / 60);
    var seconds = Math.floor(seconds % 60);
    var hours = Math.floor(minutes / 60);
    var minutes = Math.floor(minutes % 60);
    
    value = `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`
    if ( units ) {
      value = value + `.${pad(units,5)}`
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
  
module.exports = Parser
