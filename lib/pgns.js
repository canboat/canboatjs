const { flow, first, isArray, isEmpty, propertyOf } = require('lodash/fp')
const pgns = require('@canboat/pgns')
const pgnsIK = require('@canboat/pgns/pgns-ik')
const pgnsNGT = require('@canboat/pgns/pgns-ngt')
const _ = require('lodash')

function organizePGNs() {
  const res = {}
  const all = [...pgns.PGNs, ...pgnsIK.PGNs, ...pgnsNGT.PGNs]
  all.forEach(pgn => {
    if ( !res[pgn.PGN] ) {
      res[pgn.PGN] = []
    }
    res[pgn.PGN].push(pgn)
    pgn.Fields = isArray(pgn.Fields) ? pgn.Fields : (pgn.Fields ? [pgn.Fields.Field] : [])
    var reservedCount = 1
    pgn.Fields.forEach((field) => {
      if ( field.Name === 'Reserved' ) {
        field.Name = `Reserved${reservedCount++}`
      }
    })
    /*
    eval(`pgn.create = function(timestamp, prio, pgn, src, dst) {\
      return {\
        timestamp: timestamp,\
        prio: prio,\
        pgn: pgn,\
        src: src,\
        dst: dst,\
        fields: { ${pgn.fields.map(field => '"' + field.Name+'": null').join(',')} } \
      }\
    }`)
    */
  })
  return res
}

const organizedPGNs = organizePGNs()
const getPgn = pgn => organizedPGNs[pgn]
const customPgns = {}

module.exports = {
  getPgn,
  getPgn0: flow(getPgn, first),
  pgns: organizedPGNs,
  addCustomPgn: (pgn) => {
    if ( !customPgns[pgn.PGN] ) {
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
    
    return customPgns[pgn.PGN]
  },
  getCustomPgn: (pgnNum) => {
    return customPgns[pgnNum]
  }
}
