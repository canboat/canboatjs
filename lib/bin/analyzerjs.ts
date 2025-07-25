#!/usr/bin/env node

import { PGN } from '@canboat/ts-pgns'
import { Parser } from '../fromPgn'
import minimist from 'minimist'
import readline from 'readline'
import { printVersion } from './utils'
import fs from 'fs'
import util from 'util'

const argv = minimist(process.argv.slice(2), {
  alias: { h: 'help' },
  string: ['pgn', 'manufacturer', 'src', 'file', 'dst'],
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
  --src <number>        filter for the given source address
  --dst <number>        filter for the given destination address
  --manufacturer <str>  filter for pgns from the given manufacturer
  -h, --help            output usage information`)
  process.exit(1)
}

let format: number | undefined = undefined
if (argv['coalesced']) {
  format = 1
} else if (argv['fast']) {
  format = 0
}
let pgn_filter: any = argv['pgn']
const manufacturer_filter = argv['manufacturer']

if (pgn_filter !== undefined && Array.isArray(pgn_filter) === false) {
  pgn_filter = [pgn_filter]
}

let src_filter: any = argv['src']
if (src_filter !== undefined && Array.isArray(src_filter) === false) {
  src_filter = [src_filter]
}

let dst_filter: any = argv['dst']
if (dst_filter !== undefined && Array.isArray(dst_filter) === false) {
  dst_filter = [dst_filter]
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

  if (
    pgn &&
    (pgn_filter === undefined ||
      pgn_filter.find((p: string) => pgn.pgn === Number(p))) &&
    (src_filter === undefined ||
      src_filter.find((s: string) => pgn.src === Number(s))) &&
    (dst_filter === undefined ||
      dst_filter.find((d: string) => pgn.dst === Number(d)))
  ) {
    if (manufacturer_filter !== undefined) {
      const manufacturer =
        (pgn as any).fields.manufacturerCode ||
        (pgn as any).fields['Manufacturer Code']
      if (manufacturer !== manufacturer_filter) {
        return
      }
    }
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
