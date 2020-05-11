const { flow } = require('lodash/fp')

// Decode CAN Identifier (canId). ISO 11783 (CAN 2.0 B Extended Frame Format)
exports.parseCanId = (id) => {
  const res = {
    canId: id, // Include original canId in return object.
    prio: ((id >> 26) & 0x7), // Priority
    src: id & 0xff, // Source Address (SA)
  }
  const PF = (id >> 16) & 0xff // PDU Format
  const PS = (id >> 8) & 0xff // PDU Specific
  const DP =  (id >> 24) & 1 // Data Page

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
// canId should be a hex encoded string without spaces or commas.
exports.parseCanIdStr = canId => exports.parseCanId(parseInt(canId, 16))

exports.buildCanId = (prio, pgn, dst, src) => ({
  prio: Number(prio),
  pgn: Number(pgn),
  dst: Number(dst),
  src: Number(src),
})

exports.oldEncodeCanId = ({ dst, pgn, prio, src }) => {
    // src bits are the lowest ones of the CAN ID. prio bits are highest.
  const canId = src | (prio << 26) | (pgn << 8)
  // PDU 1 (assumed if 8 lowest bits of the PGN are 0)
  return ((pgn & 0xff) === 0) ? canId | (dst << 8) : canId
}

// Encode CAN Identifier (canId)
exports.encodeCanId = ({ dst, pgn, prio, src }) => {
  let canId = src & 0xff

  //I can't get this to work, but things seem ok??
  //let canId = ((src & 0xff) | 0x80000000)) // src bits are the lowest ones of the CAN ID. Also set the highest bit to 1 as n2k uses
  // only extended frames (EFF bit).

  const PF = (pgn >> 8) & 0xff

  if (PF < 240)
  { // PDU 1
    canId = (canId | ((dst & 0xff) << 8))
    canId = (canId | (pgn << 8))
  }
  else
  { // PDU 2
    canId = (canId | pgn << 8)
  }
  canId = (canId | prio << 26)
  
  return canId 
}
exports.canIdString = canId => canId.toString(16).padStart(8, '0')
exports.encodeCanIdString = flow(
  exports.encodeCanId,
  exports.canIdString,
)
// Utility function that parses and re-encodes. Compare result to original.
exports.parseEncode = x => exports.encodeCanId(exports.parseCanId(x))
