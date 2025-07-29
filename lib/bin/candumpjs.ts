#!/usr/bin/env node

import { FromPgn } from '../index'
import { parseCanId } from '../canId'
import minimist from 'minimist'
import { binToActisense } from '../utilities'
import { printVersion, setupFilters, filterPGN } from './utils'
import util from 'util'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const socketcan = require('socketcan')

const argv = minimist(process.argv.slice(2), {
  alias: {
    h: 'help'
  },
  string: ['format', 'manufacturer', 'src', 'pgn', 'dst', 'filter'],
  boolean: [
    'n',
    'r',
    'camel',
    'camel-compat',
    'show-non-matches',
    'pretty',
    'js',
    'js-colors'
  ]
})

printVersion(argv)

if (argv['help']) {
  console.error(`Usage: ${process.argv[0]} [options] candevice

Options:
  --format <format>    json, actisense
  -c                   don't check for invalid values
  -n                   output null values
  -r                   parse $MXPGN as little endian
  --pretty             pretty json
  --js                 output in JavaScript format
  --js-colors          output in JavaScript format with colors
  --camel              output field names in camelCase
  --camel-compat       output field names in camelCase and regular
  --show-non-matches   show pgn data without any matches
  --pgn <number>       filter for the given pgn number
  --src <number>       filter for the given source address
  --dst <number>       filter for the given destination address
  --manufacturer <str> filter for pgns from the given manufacturer
  --filter <js>        filter for the given JavaScript expression
  -h, --help           output usage information`)
  process.exit(1)
}

if (argv['_'].length === 0) {
  console.error('Please specify a device')
  process.exit(1)
}

const filter = setupFilters(argv)

const parser = new FromPgn({
  returnNulls: argv['n'] === true,
  littleEndianMXPGN: argv['r'] === true,
  checkForInvalidFields: argv['c'] !== true,
  useCamel: argv['camel'],
  useCamelCompat: argv['camel-compat'],
  returnNonMatches: argv['show-non-matches']
})

const format = argv['format'] || 'json'

parser.on('error', (pgn: any, error: any) => {
  console.error(`Error parsing ${pgn.pgn} ${error}`)
  console.error(error.stack)
})

parser.on('pgn', (pgn: any) => {
  if (filterPGN(pgn, filter)) {
    if (argv['js'] || argv['js-colors']) {
      console.log(
        util.inspect(pgn, {
          depth: null,
          colors: argv['js-colors'],
          breakLength: 1
        })
      )
    } else {
      console.log(JSON.stringify(pgn, null, argv['pretty'] ? 2 : 0))
    }
  }
})

const canDevice = argv['_'][0]

const channel = socketcan.createRawChannel(canDevice)

channel.addListener('onStopped', (msg: any) => {
  console.error(`socketcan stopped ${msg}`)
})

channel.addListener('onMessage', (msg: any) => {
  const pgn = parseCanId(msg.id)

  const timestamp = new Date().toISOString()

  const sourceString = binToActisense(pgn, timestamp, msg.data, msg.data.length)

  if (format === 'json') {
    parser.parse({ pgn, length: msg.data.length, data: msg.data, sourceString })
  } else {
    console.log(sourceString)
  }
})

channel.start()
