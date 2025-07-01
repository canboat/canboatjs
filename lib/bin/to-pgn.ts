#!/usr/bin/env node

import minimist from 'minimist'
import readline from 'readline'
import {
  pgnToActisenseSerialFormat,
  pgnToActisenseN2KAsciiFormat,
  pgnToiKonvertSerialFormat,
  pgnToYdgwRawFormat,
  pgnToYdgwFullRawFormat,
  pgnToPCDIN,
  pgnToMXPGN
} from '../index'

const argv = minimist(process.argv.slice(2), {
  string: ['format'],
  alias: { h: 'help' }
})

if (argv['help']) {
  console.error(`Usage: ${process.argv[0]} [options]

Options:
  --format <format>   actisense, actisensen2kascii, ikconvert, ydgw, yd-full, pcdin, mxpgn
  -h, --help          output usage information`)
  process.exit(1)
}

const formatters: { [key: string]: any } = {
  actisense: pgnToActisenseSerialFormat,
  n2kascii: pgnToActisenseN2KAsciiFormat,
  ikconvert: pgnToiKonvertSerialFormat,
  ydgw: pgnToYdgwRawFormat,
  pcdin: pgnToPCDIN,
  mxpgn: pgnToMXPGN,
  'yd-full': pgnToYdgwFullRawFormat
}

const format = argv['format'] || 'actisense'
const formatter = formatters[format]
if (!formatter) {
  console.error(`unknown format: ${argv['format']}`)
  process.exit(1)
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
})

rl.on('line', function (line) {
  const msg = JSON.parse(line)
  const res = formatter(msg)
  if (Array.isArray(res)) {
    res.forEach((m) => {
      console.log(m)
    })
  } else {
    console.log(res)
  }
  //console.log(pgnToActisenseSerialFormat(msg))
  //console.log(pgnToiKonvertSerialFormat(pgn))
  //console.log(pgnToYdgwRawFormat(msg))
})
