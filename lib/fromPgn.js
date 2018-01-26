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

const debug = require('debug')('signalk:canbusjs')
const EventEmitter = require('events')
const pkg = require('../package.json')
const _ = require('lodash')
const pgns = organizedPGNs()
const BitStream = require('bit-buffer').BitStream
const BitView = require('bit-buffer').BitView
const Int64LE = require('int64-buffer').Int64LE
const Uint64LE = require('int64-buffer').Uint64LE

var fieldTypeReaders = {}
var fieldTypePostProcessors = {}

const mainFields = [
  'timestamp',
  'prio',
  'pgn',
  'src',
  'dst'
]

const timeUnitsPerSecond = 10000
const maxUint64 = new Int64LE(0xffffffff, 0xffffffff)
const maxInt64 = new Int64LE(0x7fffffff, 0xffffffff)

//we can't handle these, so ignore them
const ignoredPgns = []//130820, 126720 ]

function organizedPGNs() {
  const pgns = require('./pgns')
  const res = {}
  pgns.PGNs.forEach(pgn => {
    if ( !res[pgn.PGN] ) {
      res[pgn.PGN] = []
    }
    res[pgn.PGN].push(pgn)
  })
  return res
}

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

    var pgnList = pgns[pgn.pgn]
    if (!pgnList) {
      this.emit('warning', pgn, `no conversion found for pgn`)
      return null
    }

    var pgnData = pgnList[0]

    pgn.fields = {}
    try {
      var fields = pgnData.Fields
      if ( !_.isArray(fields) ) {
        fields = [ fields.Field ]
      }

      for ( var i = 0; i < fields.length-pgnData.RepeatingFields; i++ ) {
        var field = fields[i]
        var hasMatch = !_.isUndefined(field.Match)

        var value = readField(this.options, !hasMatch, pgn, field, bs)

        if ( hasMatch ) {
          //console.log(`looking for ${field.Name} == ${value}`)
          //console.log(JSON.stringify(pgnList, null, 2))
          pgnList = pgnList.filter(f => f.Fields[i].Match == value)
          if ( pgnList.length == 0 ) {
            this.emit('warning', pgn, `no conversion found for pgn`)
            return null
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
          pgn.fields.list.push(group)
        }
      }

      pgn.description = pgnData.Description

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
        array[i-6] = parseInt(split[i], 16)
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
    debug(`parsed pgn ${JSON.stringify(pgn)}`)
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
  var name = field.value2name[value]
  //return name ? name : value.toString()
  return name
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
      if ( runPostProcessor ) {
        value = postProcessor(field, value)
      }
    } else {
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
        var code = industryCodes[value]
        if ( code ) {
          value = code
        }
      }

      if ( field.Units === "kWh" ) {
        value *= 3.6e6; // 1 kWh = 3.6 MJ.
      } else if (field.Units === "Ah") {
        value *= 3600.0; // 1 Ah = 3600 C.
      }

      if ( field.Offset ) {
        value += field.Offset
      }
    }
  }
  return value
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
  } else if ( field.BitLength == 48 ) {
    var a = bs.readUint16()
    var b = bs.readUint16()
    var c = bs.readUint16()
    //FIXME
  } else if ( field.BitLength == 64 ) {
    var x = bs.readUint32()
    var y = bs.readUint32()

    if ( field.Signed ) {
      value = x === 0xffffffff && y == 0x7fffffff ? null : new Int64LE(y,x)
    } else {
      value = x === 0xffffffff && y == 0xffffffff ? null : new Uint64LE(y,x)
    }
  } else {
    value = bs.readBits(field.BitLength, field.Signed)
  }

  return value
}

fieldTypeReaders['ASCII or UNICODE string starting with length and control byte'] = (pgn, field, bs) => {
  
  var len = bs.readUint8()-1
  var control = bs.readUint8()
  
  var buf = new Buffer(len)
  var idx = 0
  for ( ; idx < len && bs.bitsLeft >= 8; idx++ ) {
    var c = bs.readUint8()
    buf.writeUInt8(c, idx)
  }

  return buf.toString(control == 0 ? 'utf8' : 'ascii', 0, idx)
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

fieldTypePostProcessors['Binary data'] = (field, value) => {
  return value.toString()
}

fieldTypePostProcessors['Manufacturer code'] = (field, value) => {
  var manufacturer = manufacturerCodes[value]
  return manufacturer ? manufacturer : value
}

module.exports = { Parser: Parser, organizedPGNs: organizedPGNs }


const manufacturerCodes = {
  174: "Volvo Penta",
  199: "Actia Corporation",
  273: "Actisense",
  215: "Aetna Engineering/Fireboy-Xintex",
  135: "Airmar",
  459: "Alltek",
  274: "Amphenol LTW",
  502: "Attwood",
  381: "B&G",
  185: "Beede Electrical",
  295: "BEP",
  396: "Beyond Measure",
  148: "Blue Water Data",
  163: "Evinrude/Bombardier" ,
  394: "CAPI 2",
  176: "Carling",
  165: "CPAC",
  286: "Coelmo",
  404: "ComNav",
  440: "Cummins",
  329: "Dief",
  437: "Digital Yacht",
  201: "Disenos Y Technologia",
  211: "DNA Group",
  426: "Egersund Marine",
  373: "Electronic Design",
  427: "Em-Trak",
  224: "EMMI Network",
  304: "Empirbus",
  243: "eRide",
  1863: "Faria Instruments",
  356: "Fischer Panda",
  192: "Floscan",
  1855: "Furuno",
  419: "Fusion",
  78: "FW Murphy",
  229: "Garmin",
  385: "Geonav",
  378: "Glendinning",
  475: "GME / Standard",
  272: "Groco",
  283: "Hamilton Jet",
  88: "Hemisphere GPS",
  257: "Honda",
  467: "Hummingbird",
  315: "ICOM",
  1853: "JRC",
  1859: "Kvasar",
  85: "Kohler",
  345: "Korea Maritime University",
  499: "LCJ Capteurs",
  1858: "Litton",
  400: "Livorsi",
  140: "Lowrance",
  137: "Maretron",
  571: "Marinecraft (SK)",
  307: "MBW",
  355: "Mastervolt",
  144: "Mercury",
  1860: "MMP",
  198: "Mystic Valley Comms",
  529: "National Instruments",
  147: "Nautibus",
  275: "Navico",
  1852: "Navionics",
  503: "Naviop",
  193: "Nobeltec",
  517: "Noland",
  374: "Northern Lights",
  1854: "Northstar",
  305: "Novatel",
  478: "Ocean Sat",
  161: "Offshore Systems",
  573: "Orolia (McMurdo)",
  328: "Qwerty",
  451: "Parker Hannifin",
  1851: "Raymarine",
  370: "Rolls Royce",
  384: "Rose Point",
  235: "SailorMade/Tetra",
  580: "San Jose",
  460: "San Giorgio",
  1862: "Sanshin (Yamaha)",
  471: "Sea Cross",
  285: "Sea Recovery",
  1857: "Simrad",
  470: "Sitex",
  306: "Sleipner",
  1850: "Teleflex",
  351: "Thrane and Thrane",
  431: "Tohatsu",
  518: "Transas",
  1856: "Trimble",
  422: "True Heading",
  80: "Twin Disc",
  591: "US Coast Guard",
  1861: "Vector Cantech",
  466: "Veethree",
  421: "Vertex",
  504: "Vesper",
  358: "Victron",
  493: "Watcheye",
  154: "Westerbeke",
  168: "Xantrex",
  583: "Yachtcontrol",
  233: "Yacht Monitoring Solutions",
  172: "Yanmar",
  228: "ZF"
}

const industryCodes = {
  0: 'Global',
  1: 'Highway',
  2: 'Agriculture',
  3: 'Construction',
  4: 'Marine Industry',
  5: 'Industrial'
}
