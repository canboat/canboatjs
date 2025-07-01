import { flow } from 'lodash/fp'

export type ParsedCanID = {
  canId: number, 
  prio: number,
  src: number,
  pgn: number,
  dst: number
}

export type CanID = {
  prio: number,
  src: number,
  pgn: number,
  dst: number
}

// Decode CAN Identifier (canId). ISO 11783 (CAN 2.0 B Extended Frame Format)
export const parseCanId = (id:number): ParsedCanID => {
  const PF = (id >> 16) & 0xff // PDU Format
  const PS = (id >> 8) & 0xff // PDU Specific
  const DP =  (id >> 24) & 1 // Data Page

  let dst:number, pgn:number
  
  if (PF < 240) {
    /* PDU1 format, the PS contains the destination address */
    dst = PS;
    pgn = (DP << 16) + (PF << 8);
  } else {
    /* PDU2 format, the destination is implied global and the PGN is extended */
    dst = 0xff
    pgn = (DP << 16) + (PF << 8) + PS
  }
  return {
    canId: id, // Include original canId in return object.
    prio: ((id >> 26) & 0x7), // Priority
    src: id & 0xff, // Source Address (SA),
    pgn,
    dst
  }
}
// canId should be a hex encoded string without spaces or commas.
export const parseCanIdStr = (canId:string) => parseCanId(parseInt(canId, 16))

export const buildCanId = (prio:string|number, pgn:string|number, dst:string|number, src:string|number) : CanID => ({
  prio: Number(prio),
  pgn: Number(pgn),
  dst: Number(dst),
  src: Number(src),
})

// Encode CAN Identifier (canId)
export const encodeCanId = (id: CanID) => {
  let canId = id.src & 0xff

  //I can't get this to work, but things seem ok??
  //let canId = ((src & 0xff) | 0x80000000)) // src bits are the lowest ones of the CAN ID. Also set the highest bit to 1 as n2k uses
  // only extended frames (EFF bit).

  const PF = (id.pgn >> 8) & 0xff

  if (PF < 240)
  { // PDU 1
    canId = (canId | ((id.dst & 0xff) << 8))
    canId = (canId | (id.pgn << 8))
  }
  else
  { // PDU 2
    canId = (canId | id.pgn << 8)
  }
  canId = (canId | id.prio << 26)
  
  return canId 
}
export const  canIdString = (canId:number) => canId.toString(16).padStart(8, '0')
export const  encodeCanIdString = flow(
  encodeCanId,
  canIdString,
)
// Utility function that parses and re-encodes. Compare result to original.
export const parseEncode = (x:number) => encodeCanId(parseCanId(x))
