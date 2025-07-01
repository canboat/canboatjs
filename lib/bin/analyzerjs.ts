#!/usr/bin/env node

import { PGN } from '@canboat/pgns'
import { Parser } from '../fromPgn'
import minimist from 'minimist'
import readline from 'readline'


const argv = minimist(process.argv.slice(2), {
  alias: { h: 'help' },
  boolean: ['n', 'r', 'camel', 'camel-compat']
})

if ( argv['help'] ) {
  console.error(`Usage: ${process.argv[1]} [options]

Options:
  -c                  don't check for invalid values
  -n                  output null values
  -r                  parse $MXPGN as little endian
  --camel             output field names in camelCase
  --camel-compat      output field names in camelCase and regular
  -h, --help          output usage information`)
  process.exit(1)
}

var parser = new Parser( {
  returnNulls: argv['n'] === true,
  littleEndianMXPGN: argv['r'] === true,
  checkForInvalidFields: argv['c'] !== true,
  useCamel: argv['camel'],
  useCamelCompat: argv['camel-compat']
})

parser.on('error', (pgn:PGN, error:any) => {
  console.error(`Error parsing ${pgn.pgn} ${error}`)
  console.error(error.stack)
})

parser.on('warning', (pgn:PGN, error:any) => {
  //console.error(`Warning parsing ${pgn.pgn} ${error}`)
})

parser.on('pgn', (pgn:PGN) => {
  console.log(JSON.stringify(pgn))
})


var rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
})

var input = []
rl.on('line', (line:string) => {
  if ( argv['log-input'] ) {
    console.log(line)
  }
  if ( line.length > 13 && line.charAt(13) === ';' ) {
    if ( line.charAt(14) === 'A' ) {
      parser.parseString(line.substring(16))
    }
  } else {
    parser.parseString(line.trim())
  }
})
