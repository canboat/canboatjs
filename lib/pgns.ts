import { getPGNWithNumber } from '@canboat/ts-pgns'
import _ from 'lodash'

//import { createDebug } from './utilities'
//const debug = createDebug('canboatjs:pgns')

export const getPgn = getPGNWithNumber
export const customPgns: any = {}

export const addCustomPgns = (pgns: any, _setter: any) => {
  pgns.PGNs.forEach((pgn: any) => {
    if (!customPgns[pgn.PGN]) {
      customPgns[pgn.PGN] = {
        definitions: [],
        callbacks: []
      }
    }

    customPgns[pgn.PGN].definitions.push(pgn)

    /*
      if ( pgn.calllback ) {
      customPgns[pgn.PGN].callbacks.push()
      }
    */

    //debug('registered custom pgn %d by %s', pgn.PGN, setter)
  })

  /*
  if (pgns.LookupEnumerations) {
    pgns.LookupEnumerations.forEach((e: any) => {
      if (!lookupEnumerations[e.Name]) {
        lookupEnumerations[e.Name] = e
      } else {
        debug(`enumeration ${e.Name} already exists`)
      }
    })
    }
    */
}

export const getCustomPgn = (pgnNum: number) => {
  return customPgns[pgnNum]
}
