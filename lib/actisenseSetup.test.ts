// The NGT-1 set up as canboat does: the transmit list read on every start
// and a PGN it lacks warned about (canboat#1072), and the P-Codes read and,
// by default, switched on (canboat#1109).

import { EventEmitter } from 'events'

let opened: any[] = []

jest.mock('serialport', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter } = require('events')
  class SerialPort extends EventEmitter {
    isOpen = true
    written: Buffer[] = []
    constructor() {
      super()
      opened.push(this)
    }
    unpipe() {}
    pipe() {}
    write(buf: Buffer) {
      this.written.push(buf)
    }
    close() {}
  }
  return { SerialPort }
})

import {
  ActisenseStream,
  composeMessage,
  parsePCodeRequest
} from './actisense-serial'

const hex = (s: string) => Buffer.from(s.replace(/ /g, ''), 'hex')

/* A BEM answer of an NGT-1 (model 0x0e, serial 110763). */
const bem = (id: number, sequence: number, data: Buffer, error = 0) => {
  const header = Buffer.alloc(12)
  header[0] = id
  header[1] = sequence
  header.writeUInt16LE(0x0e, 2)
  header.writeUInt32LE(110763, 4)
  header.writeInt32LE(error, 8)
  const payload = Buffer.concat([header, data])
  return composeMessage(0xa0, payload, payload.length)
}

/* An NGT_MSG_SEND command, as written to the gateway. */
const command = (payload: string) => {
  const p = hex(payload)
  return composeMessage(0xa1, p, p.length).toString('hex')
}

const MODE_ANSWER = bem(0x11, 1, hex('02 00'))
const READ_F1 = command('49')

/* A Tx PGN Enable List F1 answer listing `pgns`: the PGNs, then the
   rates, timeouts and priorities, which are not looked at. */
const f1 = (pgns: number[]) => {
  const list = Buffer.alloc(1 + 4 * pgns.length)
  list[0] = pgns.length
  pgns.forEach((pgn, i) => list.writeUInt32LE(pgn, 1 + 4 * i))
  return [
    bem(0x49, 1, list),
    bem(0x49, 2, hex('00')),
    bem(0x49, 3, hex('00')),
    bem(0x49, 4, hex('00'))
  ]
}

const GET_PCODE = command('13')
/* The answer to Get or Set Port P-Code: the number of ports, then one
   byte per port. */
const pcodes = (data: string, error = 0) => bem(0x13, 1, hex(data), error)

describe('the NGT-1 set up as canboat does', () => {
  let stream: any
  let port: any
  let warn: jest.SpyInstance
  const open = (options: object = {}) => {
    const app = Object.assign(new EventEmitter(), {
      setProviderStatus: () => undefined,
      setProviderError: () => undefined
    })
    stream = new (ActisenseStream as any)({
      device: '/dev/ttyUSB0',
      app,
      ...options
    })
    port = opened[opened.length - 1]
    port.emit('open')
    port.emit('data', MODE_ANSWER)
  }
  const receive = (...frames: Buffer[]) =>
    frames.forEach((frame) => port.emit('data', frame))
  const sent = () => {
    const out = port.written.map((b: Buffer) => b.toString('hex'))
    port.written = []
    return out
  }
  /* Open, and answer the transmit list read (Format 1) with `pgns`. */
  const openWithList = (pgns: number[], options: object = {}) => {
    open(options)
    sent()
    jest.advanceTimersByTime(2000)
    expect(sent()).toEqual([READ_F1])
    receive(...f1(pgns))
  }

  beforeEach(() => {
    jest.useFakeTimers()
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    opened = []
  })
  afterEach(() => {
    stream.end()
    warn.mockRestore()
    jest.useRealTimers()
  })

  describe('the transmit list (canboat#1072)', () => {
    test('is read without ENABLESETTRANSMITPGNS, and output does not wait for it', () => {
      open({ pcode: 'keep' })
      expect(stream.outAvailable).toBe(true)
      sent()
      jest.advanceTimersByTime(2000)
      expect(sent()).toEqual([READ_F1])
      receive(...f1([59904, 127508]))
      // Nothing is enabled: the list is only read.
      expect(sent()).toEqual([])
    })

    test('a PGN sent that it lacks is warned about once, as Format 1 may miss it', () => {
      openWithList([59904, 127508], { pcode: 'keep' })
      stream.sendPGN({ pgn: 127508, dst: 255, fields: { instance: 1 } })
      stream.sendPGN({ pgn: 127250, dst: 255, fields: { heading: 1 } })
      stream.sendPGN({ pgn: 127250, dst: 255, fields: { heading: 1 } })
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith(
        "actisense: PGN 127250 is not on the NGT-1's transmit list as read (Format 1, which can miss some), so it may be dropped; add it to the transmitPGNs option and set ENABLESETTRANSMITPGNS to put it on the list"
      )
      // It is sent all the same.
      expect(
        sent().filter((w: string) => w.startsWith('1002' + '94'))
      ).toHaveLength(3)
    })

    test('a PDU1 PGN is looked up with its destination byte cleared', () => {
      openWithList([59904], { pcode: 'keep' })
      stream.sendString('2026-01-01T00:00:00.000Z,6,59904,0,35,3,14,f0,01')
      expect(warn).not.toHaveBeenCalled()
    })

    test('a PGN sent before the list is read is warned about once it is', () => {
      open({ pcode: 'keep' })
      sent()
      stream.sendPGN({ pgn: 127250, dst: 255, fields: { heading: 1 } })
      stream.sendPGN({ pgn: 59904, dst: 255, fields: { pgn: 60928 } })
      expect(warn).not.toHaveBeenCalled()
      jest.advanceTimersByTime(2000)
      receive(...f1([59904]))
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0][0]).toMatch(
        /^actisense: PGN 127250 is not on the NGT-1's transmit list as read/
      )
    })
  })

  describe('the P-Codes (canboat#1109)', () => {
    test('are switched on by default, once the transmit list is read', () => {
      openWithList([59904])
      expect(sent()).toEqual([GET_PCODE])
      receive(pcodes('02 00 00'))
      // With the number of ports, which an NGT-1 with software 2.690 needs.
      expect(sent()).toEqual([command('13 02 01 01')])
      receive(pcodes('02 01 01'))
      expect(sent()).toEqual([])
      expect(warn).not.toHaveBeenCalled()
    })

    test('are not written when already as asked', () => {
      openWithList([59904])
      sent()
      receive(pcodes('02 01 01'))
      expect(sent()).toEqual([])
    })

    test('only the ports that differ are written, the others left as they are', () => {
      openWithList([59904], { pcode: '1=on' })
      sent()
      receive(pcodes('02 00 00'))
      expect(sent()).toEqual([command('13 02 ff 01')])
    })

    test('are only read with get, and left alone with keep', () => {
      openWithList([59904], { pcode: 'get' })
      expect(sent()).toEqual([GET_PCODE])
      receive(pcodes('02 00 00'))
      expect(sent()).toEqual([])
      stream.end()

      openWithList([59904], { pcode: 'keep' })
      expect(sent()).toEqual([])
    })

    test('a port the gateway does not have sets nothing', () => {
      openWithList([59904], { pcode: '2=on' })
      sent()
      receive(pcodes('02 00 00'))
      expect(sent()).toEqual([])
      expect(warn).toHaveBeenCalledWith(
        'actisense: no P-Code set: port 2 does not exist, the gateway has 2 port(s)'
      )
    })

    test('a port the gateway did not take is warned about', () => {
      openWithList([59904], { pcode: 'on' })
      sent()
      receive(pcodes('02 00 00'))
      receive(pcodes('02 01 00'))
      expect(warn).toHaveBeenCalledWith(
        'actisense: the gateway did not take the P-Code of port(s) 1'
      )
    })

    test('a refused Get is warned about', () => {
      openWithList([59904])
      sent()
      receive(pcodes('', -1098))
      expect(warn).toHaveBeenCalledWith(
        'actisense: the gateway refused Get Port P-Code: error -1098'
      )
      expect(sent()).toEqual([])
    })

    test('an unanswered Get is asked once more, then left, quietly by default', () => {
      openWithList([59904])
      expect(sent()).toEqual([GET_PCODE])
      jest.advanceTimersByTime(3000)
      expect(sent()).toEqual([GET_PCODE])
      jest.advanceTimersByTime(3000)
      expect(sent()).toEqual([])
      expect(warn).not.toHaveBeenCalled()
    })

    test('an unanswered Get asked for explicitly is warned about', () => {
      openWithList([59904], { pcode: '0=on' })
      jest.advanceTimersByTime(6000)
      expect(warn).toHaveBeenCalledWith(
        'actisense: no answer to Get Port P-Code (BEM 0x13); this firmware may not have it'
      )
    })

    test('are read again after the gateway restarts', () => {
      openWithList([59904])
      sent()
      receive(pcodes('02 01 01'))
      // Startup Status, firmware 2.690, reset status 1.
      receive(bem(0xf0, 0, hex('82 0a 01 00 00 00')))
      receive(MODE_ANSWER)
      jest.advanceTimersByTime(2000)
      expect(sent()).toContain(READ_F1)
      receive(...f1([59904]))
      expect(sent()).toEqual([GET_PCODE])
    })
  })
})

describe('parsePCodeRequest', () => {
  test('on by default', () => {
    expect(parsePCodeRequest(undefined)).toEqual({ all: true })
    expect(parsePCodeRequest('')).toEqual({ all: true })
  })
  test('on, off, keep and get, and a boolean', () => {
    expect(parsePCodeRequest('ON')).toEqual({ all: true })
    expect(parsePCodeRequest('off')).toEqual({ all: false })
    expect(parsePCodeRequest('keep')).toEqual({ keep: true })
    expect(parsePCodeRequest('get')).toEqual({ get: true })
    expect(parsePCodeRequest(false)).toEqual({ all: false })
  })
  test('ports by number', () => {
    expect(parsePCodeRequest('0=off, 1=on')).toEqual({
      ports: [
        [0, false],
        [1, true]
      ]
    })
  })
  test('what is not a setting is refused', () => {
    expect(() => parsePCodeRequest('maybe')).toThrow(
      "'maybe': give on, off, keep, get or <port>=on|off"
    )
    expect(() => parsePCodeRequest('x=on')).toThrow("'x': not a port number")
    expect(() => parsePCodeRequest('1=up')).toThrow("'up': give on or off")
    expect(() => parsePCodeRequest('1=on,1=off')).toThrow(
      'port 1 is named twice'
    )
  })
})
