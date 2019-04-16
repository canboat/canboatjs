// Decode CAN Identifier (canId). ISO 11783 (CAN 2.0 B Extended Frame Format)
exports.parseCanId = (id) => {
  const res = {
    canId: id,
    src: id & 0xff, // Source Address (SA)
    prio: ((id >> 26) & 0x7), // Priority
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

// Encode CAN Identifier (canId)
exports.encodeCanId = ({ dst, pgn, prio, src }) => {
  // src bits are the lowest ones of the CAN ID. prio bits are highest.
  const canId = src | (prio << 26) | (pgn << 8)
  // PDU 1 (assumed if 8 lowest bits of the PGN are 0)
  return ((pgn & 0xff) === 0) ? canId | (dst << 8) : canId
}

// Utility function that parses and re-encodes. Compare result to original.
exports.parseEncode = x => exports.encodeCanId(exports.parseCanId(x))
