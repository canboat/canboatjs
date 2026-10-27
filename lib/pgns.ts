import {
  getPGNWithNumber,
  getEnumeration,
  getBitEnumeration,
  getEnumerationName,
  updateLookup,
  updateBitLookup
} from '@canboat/ts-pgns'
import { createDebug } from './utilities'
const debug = createDebug('canboatjs:pgns')

export const getPgn = getPGNWithNumber

/**
 * The name a field with a Match value is decoded as: its lookup's name for
 * the value, as canboat gives it (canboat#1097), else the field's
 * description.
 */
export const matchName = (field: any): string | undefined =>
  (field.FieldType === 'LOOKUP' && field.LookupEnumeration
    ? getEnumerationName(field.LookupEnumeration, field.Match)
    : undefined) ?? field.Description

/**
 * Whether a string names a field's Match value: its lookup name, or its
 * description, as canboatjs gave it before 4.0.
 */
export const isMatchName = (field: any, value: string) =>
  value === matchName(field) || value === field.Description
export const customPgns: any = {}

/**
 * Add custom PGN definitions, with the lookup tables they use. A PGN
 * definition may carry a `callback`, called with every message decoded
 * against it. A lookup table is added only under a name that is not taken,
 * so a custom definition cannot change canboat's own tables.
 */
export const addCustomPgns = (pgns: any, setter: any) => {
  pgns.PGNs.forEach((pgn: any) => {
    if (!customPgns[pgn.PGN]) {
      customPgns[pgn.PGN] = {
        definitions: [],
        callbacks: []
      }
    }

    customPgns[pgn.PGN].definitions.push(pgn)
    debug('registered custom pgn %d by %s', pgn.PGN, setter)
  })

  for (const e of pgns.LookupEnumerations ?? []) {
    if (getEnumeration(e.Name) === undefined) {
      updateLookup(e)
    } else {
      debug(`enumeration ${e.Name} already exists`)
    }
  }
  for (const e of pgns.LookupBitEnumerations ?? []) {
    if (getBitEnumeration(e.Name) === undefined) {
      updateBitLookup(e)
    } else {
      debug(`bit enumeration ${e.Name} already exists`)
    }
  }
}

export const getCustomPgn = (pgnNum: number) => {
  return customPgns[pgnNum]
}

/**
 * Whether a message of `pgn`, `length` bytes long, goes out in fast-packet
 * frames: when it does not fit one CAN frame, or when its PGN is defined as
 * fast-packet (by canboat or a custom definition). Then even a payload of 8
 * bytes or fewer is split, as 127513's is, since its receiver reads the
 * first byte as the frame header (#523). 126720 is always fast-packet.
 */
export const isFastPacket = (pgn: number, length: number) =>
  length > 8 ||
  pgn == 126720 ||
  [...(getPgn(pgn) ?? []), ...(getCustomPgn(pgn)?.definitions ?? [])].some(
    (definition: any) => definition.Type === 'Fast'
  )
