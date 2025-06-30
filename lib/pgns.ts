import { getPGN, EnumBase, Enumeration, BitEnumeration, FieldTypeEnumeration } from '@canboat/pgns'
import { getEnumerations, getFieldTypeEnumerations, getBitEnumerations} from '@canboat/pgns'
import _ from 'lodash'
import { debug as _debug } from 'debug'
const debug = _debug('canboatjs:pgns')

//const enumValues : {[key:string]: {[key:number]: string}} = {}
//const enumNames : {[key:string]: {[key:string]: number}} = {}

const enumValues:any = {}
const enumNames:any = {}

function getEnumeration(name:string) {
  const enumeration : Enumeration = lookupEnumerations[name] as Enumeration
  if ( enumeration ) {
    let vmap:any = enumValues[name]
    if ( !vmap ) {
      vmap = {}
      enumValues[name] = vmap
      enumeration.EnumValues.forEach(enumPair => {
        vmap[enumPair.Value] = enumPair.Name
      })

      const nmap:any = {}
      enumNames[name] = nmap
      enumeration.EnumValues.forEach((enumPair) => {
        nmap[enumPair.Name] = enumPair.Value
      })
    }
  }
  return enumeration
}

const ftEnumValues:any = {}
const ftEnumNames:any = {}
const ftEnumBits:any = {}

function getFieldTypeEnumeration(name:string) {
  const enumeration = lookupFieldTypeEnumerations[name] as FieldTypeEnumeration
  if ( enumeration ) {
    let vmap = ftEnumValues[name]
    if ( !vmap ) {
      vmap = {}
      ftEnumValues[name] = vmap
      enumeration.EnumFieldTypeValues.forEach((enumPair) => {
        vmap[enumPair.value] = enumPair.name
      })

      const nmap: any = {}
      ftEnumNames[name] = nmap
      enumeration.EnumFieldTypeValues.forEach((enumPair) => {
        nmap[enumPair.name] = enumPair.value
      })

      const bmap:any = {}
      ftEnumBits[name] = bmap
      enumeration.EnumFieldTypeValues.forEach((enumPair) => {
        bmap[enumPair.value] = Number(enumPair.Bits)
      })
    }
  }
  return enumeration
}

const bEnumValues:any = {}
const bEnumNames:any = {}

function getBitEnumeration(name:string) {
  const enumeration = lookupBitEnumerations[name] as BitEnumeration
  if ( enumeration ) {
    let nmap = bEnumNames[name]
    if ( !nmap ) {
      nmap = {}
      bEnumNames[name] = nmap
      enumeration.EnumBitValues.forEach((enumPair) => {
        nmap[enumPair.Bit] = enumPair.Name
      })

      const vmap:any = {}
      bEnumValues[name] = vmap
      enumeration.EnumBitValues.forEach((enumPair) => {
        vmap[enumPair.Name] = Number(enumPair.Bit)
      })
    }
  }
  return enumeration
}

export function lookupEnumerationName(enumName:string, value:number) {
  const enumeration = getEnumeration(enumName)
  return enumeration && enumValues[enumName][value]
}

export function lookupEnumerationValue(enumName:string, name:string) {
  const enumeration = getEnumeration(enumName)
  return enumeration && enumNames[enumName][name]
}

export function lookupFieldTypeEnumerationName(enumName:string, value:number) {
  const enumeration = getFieldTypeEnumeration(enumName)
  return enumeration && ftEnumValues[enumName][value]
}

export function lookupFieldTypeEnumerationBits(enumName:string, value:number) {
  const enumeration = getFieldTypeEnumeration(enumName)
  return enumeration && ftEnumBits[enumName][value]
}

export function lookupFieldTypeEnumerationValue(enumName:string, name:string) {
  const enumeration = getFieldTypeEnumeration(enumName)
  return enumeration && ftEnumNames[enumName][name]
}

export function lookupBitEnumerationName(enumName:string, value:number) {
  const enumeration = getBitEnumeration(enumName)
  return enumeration && bEnumNames[enumName][value]
}

export function lookupBitEnumerationValue(enumName:string, name:number) {
  const enumeration = getBitEnumeration(enumName)
  return enumeration && bEnumValues[enumName][name]
}

function organizeEnumerations(enums:EnumBase[]) : {[key:string]: EnumBase} {
  const map:any = {}
  enums.forEach(e => {
    map[e.Name] = e
  })
  return map
}

export const lookupEnumerations = organizeEnumerations(getEnumerations())
export const lookupFieldTypeEnumerations = organizeEnumerations(getFieldTypeEnumerations())
export const lookupBitEnumerations = organizeEnumerations(getBitEnumerations())
export const getPgn = getPGN
export const customPgns:any = {}

export const addCustomPgns = (pgns:any, setter:any) => {
  pgns.PGNs.forEach((pgn:any) => {
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
    pgns.LookupEnumerations.forEach((e:any) => {
      if ( !lookupEnumerations[e.Name] ) {
        lookupEnumerations[e.Name] = e
      } else {
        debug(`enumeration ${e.Name} already exists`)
      }
    })
  }
}
  
export const getCustomPgn = (pgnNum:number) => {
  return customPgns[pgnNum]
}

