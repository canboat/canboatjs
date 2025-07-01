#!/usr/bin/env node

import { createDebug } from '../utilities'
import net from 'net'
import { readN2KActisense } from '../n2k-actisense'
import minimist from 'minimist'

const debug = createDebug('canboatjs:w2k01')

const argv = minimist(process.argv.slice(2), {
  alias: { h: 'help' }
})

function help() {
  console.error(`Usage: ${process.argv[0]} [options] host port

Options:
  -h, --help       output usage information`)
  process.exit(1)
}

if ( argv['help'] ) {
  help()
}

if ( argv['_'].length < 2 ) {
  console.error('Please specify a host and port')
  help()
}


var client = new net.Socket();
client.connect(Number(argv['_'][1]), argv['_'][0], function() {
  debug('Connected');
});

const context = {}
client.on('data', function(data) {
  readN2KActisense(data, true, context, (result) => {
    console.log(result)
  })
});

client.on('close', function() {
  debug('Connection closed');
})

process.on('SIGINT', () => {
  debug('SIGINT signal received.');
  client.destroy()
});
  
