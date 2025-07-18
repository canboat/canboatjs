#!/usr/bin/env node

const YdvrStream = require('../ydvr.js')
const { printVersion } = require('./utils')

const argv = require('minimist')(process.argv.slice(2), {
  alias: { h: 'help' }
})

printVersion(argv)

if (argv['help']) {
  console.error(`Usage: ${process.argv[0]} file

Options:
  -h, --help       output usage information`)
  process.exit(1)
}

if (argv['_'].length === 0) {
  console.error('Please specify a file')
  process.exit(1)
}

const serial = YdvrStream()

const filestream = require('fs').createReadStream(argv['_'][0])
filestream.on('error', (err) => {
  console.error(err.message)
})
filestream.on('end', () => {
  process.exit(0)
})
filestream.pipe(serial).on('data', (chunk) => {
  console.log(JSON.stringify(chunk))
})
