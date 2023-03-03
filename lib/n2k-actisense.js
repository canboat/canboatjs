const debug = require('debug')('canboatjs:w2k01')
const debugData = require('debug')('canboatjs:w2k01-data')
const { parseCanId } = require('./canId')

exports.readN2KActisense = function (data, plainText, context, cb) {
  var inBuf = Buffer.from(data)
  var inOffset = 0

  if ( debugData.enabled ) {
    debugData('Received: (' + data.length + ') ' + Buffer.from(data).toString('hex'))
  }

  try {
    while ( true ) {
      let len = inBuf.readUInt16LE(inOffset+3)

      if ( inBuf.length < inOffset + 5 + len ) {
        /*
          I've never seen this happen
        this.lastChunk = Buffer.alloc(inBuf.length - inOffset)
        inBuf.copy(this.lastChunk, 0, inOffset, inBuf.length-1)
        */
        
        if ( debug.enabled ) {
          debug('incomplete packet: (' + len + ') ' + inBuf.toString('hex', inOffset))
        }
        
        return
      } else if ( inBuf[inOffset + 5 + len -1] != 0x03 ||
                  inBuf[inOffset + 5 + len -2] != 0x10 ) {
        if ( debug.enabled ) {
          debug('bad packet: (' + len + ') ' + inBuf.toString('hex', inOffset))
        }
        this.lastChunk = null
        return
      }
      
      let buf = Buffer.alloc(len)
      inBuf.copy(buf, 0, inOffset+5, inOffset+len+5)
      
      //console.log('NextBuf: (' + buf.length + ') ' + buf.toString('hex'))
      
      let offset = 0
      let dst = buf.readUInt8(offset)
      offset += 1
      let canid = buf.readUInt32LE(offset)
      offset += 4
      let timestamp = buf.readUInt32LE(offset)
      offset += 4
      let mhs = buf.readUInt8(offset)
      offset += 1
    
      let info = parseCanId(canid)

      //console.log(`${len} ${mhs} ${dst} (${info.src}, ${info.dst}) ${info.pgn} ${timestamp}`)
    
      let pgnData = Buffer.alloc(len-offset-3)
      buf.copy(pgnData, 0, offset, len-3)
      info.timestamp = new Date().toISOString()
      if ( plainText ) {
        cb(binToActisense(info, pgnData, pgnData.length))
      } else {
        cb({ pgn:info, length: pgnData.length, data: pgnData, coalesced: true })
      }
      inOffset += len + 5
      if ( inOffset == inBuf.length  ) {
        return
      }
    }
  } catch ( error ) {
    debug(`[error] ${error}`)
    this.lastChunk = null
    return
  }
}

function binToActisense(pgn, data, length) {
  return (
    pgn.timestamp +
      `,${pgn.prio},${pgn.pgn},${pgn.src},${pgn.dst},${length},` +
      new Uint32Array(data)
      .reduce(function(acc, i) {
        acc.push(i.toString(16));
        return acc;
      }, [])
      .map(x => (x.length === 1 ? "0" + x : x))
      .join(",")
  );
}


