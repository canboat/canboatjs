const { flow, first, isArray, isEmpty, propertyOf } = require('lodash/fp')
const canboat = require('@canboat/pgns')
const pgns = canboat.pgns
const pgnsIK = { PGNs: [] } //require('@canboat/pgns/pgns-ik')
const pgnsNGT = { PGNs: [] } //require('@canboat/pgns/pgns-ngt')
const _ = require('lodash')
const debug = require('debug')('canboatjs:pgns')

function organizePGNs() {
  const res = {}
  const all = [...canboat.getPGNs(), ...pgnsIK.PGNs, ...pgnsNGT.PGNs]
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

function getEnumeration(name) {
  const enumeration = lookupEnumerations[name]
  if ( enumeration ) {
    if ( !enumeration.value2name ) {
      enumeration.value2name = {}
      enumeration.EnumValues.forEach((enumPair) => {
        enumeration.value2name[Number(enumPair.Value)] = enumPair.Name
      })
      
      enumeration.name2value = {}
      enumeration.EnumValues.forEach((enumPair) => {
        enumeration.name2value[enumPair.Name] = Number(enumPair.Value)
      })
    }
  }
  return enumeration
}

function getFieldTypeEnumeration(name) {
  const enumeration = lookupFieldTypeEnumerations[name]
  if ( enumeration ) {
    if ( !enumeration.value2name ) {
      enumeration.value2name = {}
      enumeration.EnumFieldTypeValues.forEach((enumPair) => {
        enumeration.value2name[Number(enumPair.value)] = enumPair.name
      })
      
      enumeration.name2value = {}
      enumeration.EnumFieldTypeValues.forEach((enumPair) => {
        enumeration.name2value[enumPair.name] = Number(enumPair.value)
      })
      
      enumeration.value2bits = {}
      enumeration.EnumFieldTypeValues.forEach((enumPair) => {
        enumeration.value2bits[enumPair.value] = Number(enumPair.Bits)
      })
    }
  }
  return enumeration
}

function getBitEnumeration(name) {
  const enumeration = lookupBitEnumerations[name]
  if ( enumeration ) {
    if ( !enumeration.value2name ) {
      enumeration.value2name = {}
      enumeration.EnumBitValues.forEach((enumPair) => {
        enumeration.value2name[Number(enumPair.Bit)] = enumPair.Name
      })
      
      enumeration.name2value = {}
      enumeration.EnumBitValues.forEach((enumPair) => {
        enumeration.name2value[enumPair.Name] = Number(enumPair.Bit)
      })
    }
  }
  return enumeration
}

function lookupEnumerationName(enumName, value) {
  const enumeration = getEnumeration(enumName)
  return enumeration && enumeration.value2name[value]
}

function lookupEnumerationValue(enumName, name) {
  const enumeration = getEnumeration(enumName)
  return enumeration && enumeration.name2value[name]
}

function lookupFieldTypeEnumerationName(enumName, value) {
  const enumeration = getFieldTypeEnumeration(enumName)
  return enumeration && enumeration.value2name[value]
}

function lookupFieldTypeEnumerationBits(enumName, value) {
  const enumeration = getFieldTypeEnumeration(enumName)
  return enumeration && enumeration.value2bits[value]
}

function lookupFieldTypeEnumerationValue(enumName, name) {
  const enumeration = getFieldTypeEnumeration(enumName)
  return enumeration && enumeration.name2value[name]
}

function lookupBitEnumerationName(enumName, value) {
  const enumeration = getBitEnumeration(enumName)
  return enumeration && enumeration.value2name[value]
}

function lookupBitEnumerationValue(enumName, name) {
  const enumeration = getBitEnumeration(enumName)
  return enumeration.name2value[name]
}

function organizeEnumerations(enums) {
  let map = {}
  enums.forEach(e => {
    map[e.Name] = e
  })
  return map
}

const lookupEnumerations = organizeEnumerations(pgns.LookupEnumerations)
const lookupFieldTypeEnumerations = organizeEnumerations(pgns.LookupFieldTypeEnumerations)
const lookupBitEnumerations = organizeEnumerations(pgns.LookupBitEnumerations)
const organizedPGNs = organizePGNs()
const getPgn = pgn => organizedPGNs[pgn]
const getPgn0 = flow(getPgn, first)
const customPgns = {}

module.exports = {
  getPgn,
  getPgn0,
  pgns: organizedPGNs,
  lookupEnumerationName,
  lookupEnumerationValue,
  lookupFieldTypeEnumerationName,
  lookupFieldTypeEnumerationValue,
  lookupFieldTypeEnumerationBits,
  lookupBitEnumerationName,
  lookupBitEnumerationValue,
  addCustomPgns: (pgns, setter) => {
    pgns.PGNs.forEach(pgn => {
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
      
      debug('registered custom pgn %d by %s', pgn.PGN, setter)
    })

    if ( pgns.LookupEnumerations ) {
      pgns.LookupEnumerations.forEach(e => {
        if ( !lookupEnumerations[e.Name] ) {
          lookupEnumerations[e.Name] = e
        } else {
          debug(`enumeration ${e.Name} already exists`)
        }
      })
    }
  },
  getCustomPgn: (pgnNum) => {
    return customPgns[pgnNum]
  },
  getEnumForField: (pgnNumber, fieldName) => {
  }
}
