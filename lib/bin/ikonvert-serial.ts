#!/usr/bin/env node

import { Transform } from 'stream'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SerialPort } = require('serialport')

if ( process.argv.length < 3 ) {
  console.error('Please specify a device')
  console.error('usage: ikonvert-serial [device] [baud,default:230400]')
  process.exit(1)
}

let device = process.argv[2]

let baud = process.argv.length > 3 ? Number(process.argv[3]) : 230400

let serial = new SerialPort({
  path:device,
  baudRate: baud
})


const toStringTr = new Transform({
  objectMode: true,

  transform(line, encoding, callback) {
    //this.push(JSON.stringify(chunk) + "\n");
    console.log(line)

    if ( line.startsWith('$PDGY,000000,,,,,') ) {
      serial.write('$PDGY,N2NET_INIT,ALL\r\n')
    }

    callback();
  }
});

serial.on(
  'open',
  function () {
    const parser = new SerialPort.parsers.Readline()
    serial.pipe(parser).pipe(toStringTr)
  }
)

serial.on(
  'error',
  (x:any) => {
    console.log(x)
  }
)
