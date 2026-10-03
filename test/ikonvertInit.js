const { expect } = require('chai')
const { EventEmitter } = require('events')
const { iKonvertStream } = require('../dist/ikonvert')

// The init handshake, as canboat's iKonvert codec runs it (#387).
describe('iKonvert initialisation', function () {
  function gateway() {
    const app = new EventEmitter()
    const sent = []
    app.on('ikonvertOut', (msg) => sent.push(msg))
    app.setProviderStatus = () => {}
    app.setProviderError = () => {}
    let available = 0
    app.on('nmea2000OutAvailable', () => available++)
    const stream = new iKonvertStream({ app, providerId: 'ik' })
    const line = (l) =>
      stream._transform(Buffer.from(l + '\r\n'), 'utf8', () => {})
    // Answer each command as the device does, until setup completes.
    const answerAll = () => {
      const answers = {
        '$PDGY,N2NET_OFFLINE': '$PDGY,TEXT,Digital_Yacht_iKonvert_v2',
        '$PDGY,TX_LIMIT,OFF': '$PDGY,ACK,TX_LIMIT',
        '$PDGY,N2NET_INIT,ALL': '$PDGY,ACK,N2NET_INIT,ALL'
      }
      for (let i = 0; i < 10 && !stream.isSetup; i++) {
        const last = sent[sent.length - 1]
        const reply = last.startsWith('$PDGY,TX_LIST')
          ? '$PDGY,ACK,TX_LIST'
          : answers[last]
        line(reply)
      }
    }
    return { stream, sent, line, answerAll, available: () => available }
  }

  it('initialises a device that answers on a clean line', function () {
    const g = gateway()
    g.line('$PDGY,000000,,,,,,') // anything starts the handshake
    expect(g.sent).to.deep.equal(['$PDGY,N2NET_OFFLINE'])
    g.answerAll()
    expect(g.stream.isSetup).to.equal(true)
    expect(g.stream.cansend).to.equal(true)
  })

  it('finds the banner spliced onto a cut-off frame line', function () {
    // An already initialised iKonvert streams frames; N2NET_OFFLINE makes
    // it reboot mid-line, and the banner follows without a line end.
    const g = gateway()
    g.line('!PDGY,129033,3,160,255,9688.16,7U/cwPIuAAA=')
    g.line(
      '!PDGY,126992,3,160,255,9688.26,///tT6DK$PDGY,TEXT,Digital_Yacht_iKonvert_v2'
    )
    expect(g.sent[g.sent.length - 1]).to.equal('$PDGY,TX_LIMIT,OFF')
    g.answerAll()
    expect(g.stream.isSetup).to.equal(true)
  })

  it('initialises again when the device reboots after setup', function () {
    const g = gateway()
    g.line('$PDGY,000000,,,,,,')
    g.answerAll()
    expect(g.available()).to.equal(1)
    const sentBefore = g.sent.length
    g.line('$PDGY,TEXT,Digital_Yacht_iKonvert_v2') // rebooted by itself
    expect(g.stream.cansend).to.equal(false)
    // Already offline, so the banner answers the first step: on to the next.
    expect(g.sent[sentBefore]).to.equal('$PDGY,TX_LIMIT,OFF')
    g.answerAll()
    expect(g.stream.cansend).to.equal(true)
  })
})
