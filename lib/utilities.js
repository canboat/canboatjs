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

const deviceClassCodes = {
  0: 'Reserved for 2000 Use',
  10: 'System tools',
  20: 'Safety systems',
  25: 'Internetwork device',
  30: 'Electrical Distribution',
  35: 'Electrical Generation',
  40: 'Steering and Control surfaces',
  50: 'Propulsion',
  60: 'Navigation',
  70: 'Communication',
  75: 'Sensor Communication Interface',
  80: 'Instrumentation/general systems',
  85: 'External Environment',
  90: 'Internal Environment',
  100: 'Deck + cargo + fishing equipment systems',
  120: 'Display',
  125: 'Entertainment'
}

const deviceClassNames = reverseMap(deviceClassCodes)
const manufacturerNames = reverseMap(manufacturerCodes)
const industryNames = reverseMap(industryCodes)
industryNames['Marine'] = 4

function reverseMap(map) {
  var res = {}
  _.keys(map).forEach(key => {
    res[map[key]] = key
  })
  return res
}

function getIndustryName(code) {
  return industryCodes[code]
}

function getIndustryCode(name) {
  return industryNames[name]
}

function getManufacturerCode(name) {
  return manufacturerNames[name]
}

function getManufacturerName(code) {
  return manufacturerCodes[code]
}

function getDeviceClassCode(name) {
  return deviceClassNames[name]
}

function getDeviceClassName(code) {
  return deviceClassCodes[code]
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


const defaultTransmitPGNs = [
  60928,
  59904,
  126996,
  126464,
  128267,
  129794,
  129038,
  129041,
  127505,
  127506,
  127508,
  129026,
  129025,
  129029,
  127250,
  130306,
  127502
]

module.exports.getCanIdFromPGN = getCanIdFromPGN
module.exports.getCanIdFromYdgwPGN = getCanIdFromYdgwPGN
module.exports.actisenseSerialToBuffer = actisenseSerialToBuffer
module.exports.getIndustryName = getIndustryName
module.exports.getManufacturerName = getManufacturerName
module.exports.getIndustryCode = getIndustryCode
module.exports.getManufacturerCode = getManufacturerCode
module.exports.getDeviceClassName = getDeviceClassName
module.exports.getDeviceClassCode = getDeviceClassCode
module.exports.defaultTransmitPGNs = defaultTransmitPGNs
module.exports.getPlainPGNs = getPlainPGNs
