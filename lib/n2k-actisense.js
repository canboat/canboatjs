const debug = require('debug')('canboatjs:w2k01')
const debugData = require('debug')('canboatjs:w2k01-data')
const { parseCanId, encodeCanId } = require('./canId')
const BitStream = require('bit-buffer').BitStream
const { binToActisense } = require('./utilities')

exports.readN2KActisense = function (data, plainText, context, cb) {
  const inBuf = Buffer.from(data)
  let inOffset = 0
  let last

  if ( debugData.enabled ) {
    debugData('Received: (' + data.length + ') ' + Buffer.from(data).toString('hex'))
  }

  try {
    while ( true ) {
      let len = inBuf.readUInt16LE(inOffset+3)

      if ( inBuf.length < inOffset + 5 + len ) {
        /*
          I've never seen this happen
        context.lastChunk = Buffer.alloc(inBuf.length - inOffset)
        inBuf.copy(context.lastChunk, 0, inOffset, inBuf.length-1)
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
        //context.lastChunk = null
        return
      }
      
      let buf = Buffer.alloc(len)
      inBuf.copy(buf, 0, inOffset+5, inOffset+len+5)
      
      //console.log('NextBuf: (' + buf.length + ') ' + buf.toString('hex'))
      
      let offset = 0
      let _dst = buf.readUInt8(offset)
      offset += 1
      let canid = buf.readUInt32LE(offset)
      offset += 4
      let _timestamp = buf.readUInt32LE(offset)
      offset += 4
      let _mhs = buf.readUInt8(offset)
      offset += 1
    
      let info = parseCanId(canid)

      //console.log(`${len} ${mhs} ${dst} (${info.src}, ${info.dst}) ${info.pgn} ${timestamp}`)
    
      let pgnData = Buffer.alloc(len-offset-3)
      buf.copy(pgnData, 0, offset, len-3)
      info.timestamp = new Date().toISOString()
      
      if ( plainText ) {
        last = binToActisense(info, pgnData, pgnData.length)
        cb && cb(last)
      } else {
        last = { pgn:info, length: pgnData.length, data: pgnData, coalesced: true }
        cb && cb(last)
      }
      
      inOffset += len + 5
      if ( inOffset == inBuf.length  ) {
        return last
      }
    }
  } catch ( error ) {
    debug(`[error] ${error}`)
    //context.lastChunk = null
    return
  }
}

exports.encodeN2KActisense  = ({
  // eslint-disable-next-line no-unused-vars
  pgn, data, timestamp, prio = 2, dst = 255, src = 0 }) => {
    const bs = new BitStream(Buffer.alloc(18 + data.length))

    bs.writeUint8(0x10) //BST Message ID
    bs.writeUint8(0x02)
    bs.writeUint8(0xd0)

    bs.writeUint16(13 + data.length) //len
    bs.writeUint8(dst)
    bs.writeUint32(encodeCanId({dst, pgn, prio, src}))
    bs.writeUint32(0) //timestamp
    bs.writeUint8(0) //mhs
    data.copy(bs.view.buffer, bs.byteIndex, 0)
    bs.byteIndex += data.length
    bs.writeUint8(0) // ??
    bs.writeUint8(0x10)
    bs.writeUint8(0x03)

    if ( debugData.enabled ) {
      debugData('encoded: ' + bs.view.buffer.toString('hex'))
    }
    
    return bs.view.buffer
  }
