#!/usr/bin/env node

import { PGN } from '@canboat/ts-pgns'
import { Parser } from '../fromPgn'
import minimist from 'minimist'
import readline from 'readline'
import { printVersion } from './utils'

const argv = minimist(process.argv.slice(2), {
  alias: { h: 'help' },
  boolean: [
    'n',
    'r',
    'camel',
    'camel-compat',
    'show-non-matches',
    //'show-create-pgns',
    'pretty',
    'show-warnings',
    'coalesced'
  ]
})

printVersion(argv)

if (argv['help']) {
  console.error(`Usage: ${process.argv[1]} [options]

Options:
  -c                  don't check for invalid values
  -n                  output null values
  -r                  parse $MXPGN as little endian
  --pretty            pretty json 
  --camel             output field names in camelCase
  --camel-compat      output field names in camelCase and regular
  --show-non-matches  show pgn data without any matches
  --show-warnings     show warning messages
  --coalesced         force coalesced format
  --fast              force fast format
  -h, --help          output usage information`)
  process.exit(1)
}

let format: number | undefined = undefined
if (argv['coalesced']) {
  format = 1
} else if (argv['fast']) {
  format = 0
}

const parser = new Parser({
  returnNulls: argv['n'] === true,
  littleEndianMXPGN: argv['r'] === true,
  checkForInvalidFields: argv['c'] !== true,
  useCamel: argv['camel'],
  useCamelCompat: argv['camel-compat'],
  returnNonMatches: argv['show-non-matches'],
  format
})

parser.on('error', (pgn: PGN, error: any) => {
  console.error(`Error parsing ${pgn.pgn} ${error}`)
  console.error(error.stack)
})

parser.on('warning', (pgn: PGN, error: any) => {
  if (argv['show-warnings']) {
    console.error(`Warning parsing ${pgn.pgn} ${error}`)
  }
})

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
})

rl.on('line', (line: string) => {
  if (argv['log-input']) {
    console.log(line)
  }
  let pgn: PGN | undefined
  if (line.length > 13 && line.charAt(13) === ';') {
    if (line.charAt(14) === 'A') {
      pgn = parser.parseString(line.substring(16))
    }
  } else {
    pgn = parser.parseString(line.trim())
  }

  if (pgn) {
    /*
    if ( argv['show-create-pgns'] ) {
      let dst = ''
      if ( pgn.dst !== 255 ) {
        dst = ', 255'
      }
      console.log(`const pgn = new ${pgn.constructor.name}(${JSON.stringify(pgn.fields, null, 2)}${dst})`)
      } else
      */
    {
      console.log(JSON.stringify(pgn, null, argv['pretty'] ? 2 : 0))
    }
  }
})
