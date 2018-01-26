const pgns = require('./fromPgn').organizedPGNs()
const _ = require('lodash')
const BitStream = require('bit-buffer').BitStream
const Int64LE = require('int64-buffer').Int64LE
const Uint64LE = require('int64-buffer').Uint64LE

function toPgn(data) {
  const pgnList = pgns[data.pgn]
  if (!pgnList) {
    console.log("no pgn found: " + data.pgn)
    return
  }
  
  const pgnData = pgnList[0]

  var acc = new BitStream(new Buffer(500))

  pgnData.Fields.forEach(field => {
    var value = data[field.Name];
    if (isDefined(value) && field.Resolution) {
      value = (value / field.Resolution).toFixed(0);
    }
    if (field.EnumValues && _.isString(value)) {
      if (!(field.Id === "timeStamp" && value < 60)) {
        console.log(`lookup ${field.Name} ${value}`)
        value = lookup(field, value)
      }
    }

    if ( _.isUndefined(value) ) {
      if ( field.BitLength % 8  == 0 ) {
        var bytes = field.BitLength/8
        var lastByte = field.Signed ? 0x7f : 0xff
        for ( var i = 0; i < bytes-1; i++ ) {
          acc.writeUint8(0xff)
        }
        acc.writeUint8(field.Signed ? 0x7f : 0xff)
      } else {
        acc.writeBits(0xffff, field.BitLength)
      }
    } else if (field.BitLength === 8) {
      if (field.Signed) {
        acc.writeInt8(value)
      } else {
        acc.writeUint8(value)
      }
    } else if (field.BitLength === 16) {
      if (field.Signed) {
        acc.writeInt16(value)
      } else {
        acc.writeUint16(value)
      }
    } else if (field.BitLength === 32) {
      if (field.Signed) {
        acc.writeInt32(value)
      } else {
        acc.writeUint32(value)
      }
    } else if (field.BitLength === 64) {
      var num
      if (field.Signed) {
        num = new Int64LE(value)
      } else {
        num = new Int64LE(value)
      }
      var buf = num.toBuffer()
      buf.copy(acc.view.buffer, acc.byteIndex)
      acc.byteIndex += buf.length
    } else {
      acc.writeBits(value, field.BitLength)
    }
  })
  return acc.view.buffer.slice(0, acc.byteIndex)
}

function lookup(field, stringValue) {
  if (!field.name2value) {
    field.name2value = {};
    field.EnumValues.forEach(function(enumPair) {
      field.name2value[enumPair.name] = Number(enumPair.value)
    })
  }
  return (field.name2value[stringValue]);
}

function isDefined(value) {
  return typeof value !== 'undefined' && value != null
}

function parseHex(s) {
  return parseInt(s, 16)
};

function canboat2Buffer(canboatData) {
  return new Buffer(canboatData.split(',').slice(6).map(parseHex), 'hex');
}

function toActisenseSerialFormat(pgn, data, dst) {
  dst = _.isUndefined(dst) ? '255' : dst
  return (
    new Date().toISOString() +
      ",2," +
      pgn +
      `,0,${dst},` +
      data.length +
      "," +
      new Uint32Array(data)
      .reduce(function(acc, i) {
        acc.push(i.toString(16));
        return acc;
      }, [])
      .map(x => (x.length === 1 ? "0" + x : x))
      .join(",")
  );
}

module.exports.canboat2Buffer = canboat2Buffer
module.exports.toPgn = toPgn
module.exports.toActisenseSerialFormat = toActisenseSerialFormat

