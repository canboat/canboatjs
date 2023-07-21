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

function getField(pgn, name) {
  return pgn.Fields.find(f => f.Name === name)
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

function lookupEnumerationName(enumName, value) {
  const enumeration = getEnumeration(enumName)
  return enumeration.value2name[value]
}

function lookupEnumerationValue(enumName, name) {
  const enumeration = getEnumeration(enumName)
  return enumeration.name2value[name]
}

function getValue2Name(field) {
  if (!field.value2name && field.EnumValues) {
    field.value2name = {};
    field.EnumValues.forEach(function(enumPair) {
      field.value2name[Number(enumPair.value)] = enumPair.name
    })
  }
  return field.value2name
}

function getName2Value(field) {
  if (!field.name2value && field.EnumValues) {
    field.name2value = {};
    field.EnumValues.forEach(function(enumPair) {
      field.name2value[enumPair.name] = Number(enumPair.value)
    })
  }
  return field.name2value
}

function lookupEnumNameForField(field, value) {
  let value2name = getValue2Name(field)
  return value2name && value2name[value]
}

function lookupEnumValueForField(field, stringValue) {
  let name2value = getName2Value(field)
  return name2value && name2value[stringValue]
}

function organizeEnumerations() {
  let enums = require('@canboat/pgns/canboat').LookupEnumerations
  let map = {}
  enums.forEach(e => {
    map[e.Name] = e
  })
  return map
}

const lookupEnumerations = organizeEnumerations()
const organizedPGNs = organizePGNs()
const getPgn = pgn => organizedPGNs[pgn]
const getPgn0 = flow(getPgn, first)
const customPgns = {}

module.exports = {
  getPgn,
  getPgn0,
  pgns: organizedPGNs,
  lookupEnumValueForField,
  lookupEnumNameForField,
  lookupEnumerationName,
  lookupEnumerationValue,
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
  },
  getEnumForField: (pgnNumber, fieldName) => {
  }
}
