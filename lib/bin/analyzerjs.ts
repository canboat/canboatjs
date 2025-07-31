#!/usr/bin/env node

import { PGN } from '@canboat/ts-pgns'
import { Parser } from '../fromPgn'
import minimist from 'minimist'
import readline from 'readline'
import { printVersion } from './utils'
import { setupFilters, filterPGN, FilterOptions } from '../utilities'
import fs from 'fs'
import util from 'util'

const argv = minimist(process.argv.slice(2), {
  alias: { h: 'help' },
  string: ['pgn', 'manufacturer', 'src', 'file', 'dst', 'filter', 'id'],
  boolean: [
    'n',
    'r',
    'camel',
    'camel-compat',
    'show-non-matches',
    //'show-create-pgns',
    'pretty',
    'show-warnings',
    'coalesced',
    'js',
    'js-colors'
  ]
})

printVersion(argv)

if (argv['help']) {
  console.error(`Usage: ${process.argv[1]} [options]

Options:
  -c                    don't check for invalid values
  -n                    output null values
  -r                    parse $MXPGN as little endian
  --file <path>         read from the given file
  --pretty              output pretty json
  --js                  output in JavaScript format
  --js-colors           output in JavaScript format with colors
  --camel               output field names in camelCase
  --camel-compat        output field names in camelCase and regular
  --show-non-matches    show pgn data without any matches
  --show-warnings       show warning messages
  --coalesced           force coalesced format
  --fast                force fast format
  --pgn <number>        filter for the given pgn number
  --id <camelCaseId>    filter for the given pgn id
  --src <number>        filter for the given source address
  --dst <number>        filter for the given destination address
  --manufacturer <str>  filter for pgns from the given manufacturer
  --filter <js>         filter for the given JavaScript expression
  -h, --help            output usage information`)
  process.exit(1)
}

let format: number | undefined = undefined
if (argv['coalesced']) {
  format = 1
} else if (argv['fast']) {
  format = 0
}

const filter = setupFilters(argv as unknown as FilterOptions)

const parser = new Parser({
  returnNulls: argv['n'] === true,
  littleEndianMXPGN: argv['r'] === true,
  checkForInvalidFields: argv['c'] !== true,
  useCamel: argv['camel'],
  useCamelCompat: argv['camel-compat'],
  returnNonMatches: argv['show-non-matches'],
  includeInputData: true,
  createPGNObjects: true,
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

let rl
const file = argv['file']
if (file) {
  const fileStream = fs.createReadStream(file)
  rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity // This option ensures that '\r\n' is treated as a single line break
  })
} else {
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  })
}

rl.on('line', (line: string) => {
  if (argv['log-input']) {
    console.log(line)
  }
  if (line.length === 0) {
    return
  }
  let pgn: PGN | undefined
  if (line.length > 13 && line.charAt(13) === ';') {
    if (line.charAt(14) === 'A') {
      pgn = parser.parseString(line.substring(16))
    }
  } else {
    pgn = parser.parseString(line.trim())
  }

  if (pgn && filterPGN(pgn, filter)) {
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
