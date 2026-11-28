const { expect } = require('chai')
const { EventEmitter } = require('events')
const net = require('net')
const split = require('split')
const { iKonvertStream } = require('../dist/ikonvert')

// #596: the gateway's web configuration may leave it already initialised.
// Model the vendor's command responses over TCP; no physical gateway is used.
describe('NavLink2 initialisation', function () {
  for (const alreadyInitialised of [true, false]) {
    it(`configures a ${alreadyInitialised ? 'running' : 'fresh'} gateway`, async function () {
      let initialised = alreadyInitialised
      let peer
      const commands = []
      let finish
      const complete = new Promise((resolve) => {
        finish = resolve
      })
      const server = net.createServer((socket) => {
        peer = socket
        const lines = socket.pipe(split())
        lines.on('data', (raw) => {
          const command = raw.toString().trim()
          if (!command) return
          commands.push(command)
          let reply
          if (command === '$PDGY,N2NET_OFFLINE') {
            reply = '$PDGY,TEXT,Digital_Yacht_NavLink2'
          } else if (command === '$PDGY,N2NET_RESET') {
            initialised = false
            reply = '$PDGY,ACK,N2NET_RESET'
          } else if (command === '$PDGY,N2NET_MODE,15') {
            reply = '$PDGY,ACK,N2NET_MODE'
          } else if (command === '$PDGY,TX_LIMIT,OFF') {
            reply = '$PDGY,ACK,TX_LIMIT'
          } else if (command.startsWith('$PDGY,TX_LIST,')) {
            reply = initialised
              ? '$PDGY,NAK,ALREADY_INITIALISED'
              : '$PDGY,ACK,TX_LIST'
          } else if (command === '$PDGY,N2NET_INIT,ALL') {
            initialised = true
            reply = '$PDGY,ACK,N2NET_INIT,ALL'
          }
          if (reply) socket.write(reply + '\r\n')
          if (reply === '$PDGY,NAK,ALREADY_INITIALISED') finish(false)
        })
        socket.write('$PDGY,000000,,,,,,,\r\n')
      })
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
      const app = new EventEmitter()
      const socket = net.connect(server.address().port, '127.0.0.1')
      app.on('navlink2-out', (command) => socket.write(command))
      app.on('nmea2000OutAvailable', () => finish(true))
      const stream = new iKonvertStream({ app, tcp: true })
      const incoming = socket.pipe(split())
      incoming.on('data', (line) => stream.write(line))
      let timeout
      try {
        const setup = await Promise.race([
          complete,
          new Promise((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error('setup timed out')),
              1500
            )
          })
        ])
        expect(setup, `commands: ${commands.join('; ')}`).to.equal(true)
        expect(stream.cansend).to.equal(true)
        expect(commands.indexOf('$PDGY,N2NET_RESET')).to.be.lessThan(
          commands.findIndex((c) => c.startsWith('$PDGY,TX_LIST,'))
        )
        const frame = '!PDGY,129033,3,160,255,9688.16,7U/cwPIuAAA='
        const delivered = new Promise((resolve) => stream.once('data', resolve))
        peer.write(frame + '\r\n')
        expect(await delivered).to.equal(frame)
      } finally {
        clearTimeout(timeout)
        stream.end()
        incoming.destroy()
        socket.destroy()
        if (peer) peer.destroy()
        await new Promise((resolve) => server.close(resolve))
      }
    })
  }
})
