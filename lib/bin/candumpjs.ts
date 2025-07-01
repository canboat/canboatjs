#!/usr/bin/env node

import { FromPgn } from '../index'
import { parseCanId } from '../canId'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const socketcan = require('socketcan')
import { binToActisense } from '../utilities'


const parser = new FromPgn()


const argv = require('minimist')(process.argv.slice(2), {
  alias: { h: 'help' }
})

if ( argv['help'] ) {
  console.error(`Usage: ${process.argv[0]} [options] candevice

Options:
  --format <format>    json, actisense
  -h, --help           output usage information`)
  process.exit(1)
}

if ( argv['_'].length === 0 ) {
  console.error('Please specify a device')
  process.exit(1)
}

const format = argv['format'] || 'json'

/*

let messageCb = (data) => {
  let jsonData = parser.parse(data, (err) => { if ( err ) console.error(err) })
  if ( jsonData ) {
    console.log(data)
  }
}

let simpleCan = new canboatjs.SimpleCan({
  canDevice: argv['_'][0],
  preferredAddress: 35,
  disableDefaultTransmitPGNs: true,
  transmitPGNs: [],
}, messageCb)

simpleCan.start()

*/

parser.on('error', (pgn, error) => {
  console.error(`Error parsing ${pgn.pgn} ${error}`)
  console.error(error.stack)
})

parser.on('pgn', (pgn) => {
  console.log(JSON.stringify(pgn))
})


const canDevice = argv['_'][0]

const channel = socketcan.createRawChannel(canDevice);

channel.addListener('onStopped', (msg:any) => {
  console.error(`socketcan stopped ${msg}`)
})

channel.addListener('onMessage', (msg:any) => {
  var pgn = parseCanId(msg.id)
  
  const timestamp = new Date().toISOString()

  let sourceString = binToActisense(pgn, timestamp, msg.data, msg.data.length)

  if ( format === 'json' ) {
    parser.parse({ pgn, length: msg.data.length, data: msg.data, sourceString })
  } else {
    console.log(sourceString)
  }
})

channel.start()
