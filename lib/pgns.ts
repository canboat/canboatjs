import {
  getPGNWithNumber,
  getEnumeration,
  getBitEnumeration,
  updateLookup,
  updateBitLookup
} from '@canboat/ts-pgns'
import { createDebug } from './utilities'
const debug = createDebug('canboatjs:pgns')

export const getPgn = getPGNWithNumber
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
