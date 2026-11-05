// An NGX in CAN Packet Mode (#514): set to operating mode 5, it passes raw
// CAN frames as BST-95 both ways, and canboatjs is a CAN device itself.
// From the Actisense SDK: BST-95-can-frame.md, operating-mode.md, and its
// candirect utility.

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

import { ActisenseStream, composeMessage } from './actisense-serial'
import { bdtpEncode } from './bdtp'

const hex = (s: string) => Buffer.from(s.replace(/ /g, ''), 'hex')

/* A BEM answer of an NGX (model 0x1234, serial 123456). */
const bem = (id: number, sequence: number, data: Buffer, error = 0) => {
  const header = Buffer.alloc(12)
  header[0] = id
  header[1] = sequence
  header.writeUInt16LE(0x1234, 2)
  header.writeUInt32LE(123456, 4)
  header.writeInt32LE(error, 8)
  const payload = Buffer.concat([header, data])
  return composeMessage(0xa0, payload, payload.length)
}
const modeAnswer = (mode: number) =>
  bem(0x11, 1, Buffer.from([mode & 0xff, mode >> 8]))

/* A BEM command, as written to the gateway. */
const command = (payload: string) => {
  const p = hex(payload)
  return composeMessage(0xa1, p, p.length).toString('hex')
}
const GET_PRODUCT_INFO = command('41')
const GET_MODE = command('11')
const SET_CAN_PACKET = command('11 05 00')
const SET_RX_ALL = command('11 02 00')

/* A BST-95 message with its checksum, BDTP-framed: the SDK's example,
   129026 from source 48, received from the bus. */
const bst95 = (body: string) => {
  const m = hex(body)
  const sum = m.reduce((a, b) => (a + b) & 0xff, 0)
  return bdtpEncode(Buffer.concat([m, Buffer.from([(256 - sum) & 0xff])]))
}
const COG_SOG = bst95('95 0E 01 20 30 02 F8 09 FF FC 37 0A 00 10 FF FF')

describe('an NGX in CAN Packet Mode (#514)', () => {
  let stream: any
  let port: any
  let app: any
  let warn: jest.SpyInstance
  const open = (options: object = {}, mode = 5) => {
    app = Object.assign(new EventEmitter(), {
      setProviderStatus: () => undefined,
      setProviderError: () => undefined
    })
    stream = new (ActisenseStream as any)({
      device: '/dev/ttyUSB0',
      app,
      canPacketMode: true,
      ...options
    })
    port = opened[opened.length - 1]
    port.emit('open')
    port.emit('data', modeAnswer(mode))
  }
  const sent = () => {
    const out = port.written.map((b: Buffer) => b.toString('hex'))
    port.written = []
    return out
  }
  const pushed: any[] = []

  beforeEach(() => {
    jest.useFakeTimers()
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    opened = []
    pushed.length = 0
  })
  afterEach(() => {
    stream.end()
    warn.mockRestore()
    jest.useRealTimers()
  })

  test('sets a gateway in another mode to CAN Packet Mode', () => {
    open({}, 2)
    const out = sent()
    expect(out.slice(0, 2)).toEqual([GET_PRODUCT_INFO, GET_MODE])
    expect(out).toContain(SET_CAN_PACKET)
  })

  test('leaves a gateway in CAN Packet Mode, and reads no transmit list or P-Codes', () => {
    open({}, 5)
    jest.advanceTimersByTime(10000)
    const out = sent()
    expect(out).not.toContain(SET_CAN_PACKET)
    // 49: Tx PGN Enable List F1, 13: Port P-Code: neither is asked.
    expect(out.filter((w: string) => /^1002a1..(49|13|40)/.test(w))).toEqual([])
  })

  test('sets an NGX left in CAN Packet Mode back without the option', () => {
    open({ canPacketMode: false, pcode: 'keep' }, 5)
    expect(sent()).toContain(SET_RX_ALL)
  })

  test('hands a CAN frame from the bus on as one frame', () => {
    open()
    stream.on('data', (d: any) => pushed.push(d))
    port.emit('data', COG_SOG)
    expect(pushed).toHaveLength(1)
    expect(pushed[0].pgn).toMatchObject({
      pgn: 129026,
      src: 48,
      dst: 255,
      prio: 2
    })
    expect(pushed[0].data.toString('hex')).toBe('fffc370a0010ffff')
    expect(pushed[0].length).toBe(8)
  })

  test('skips a frame on its way to the bus: the gateway echoing ours', () => {
    open()
    stream.on('data', (d: any) => pushed.push(d))
    port.emit('data', bst95('95 0E 01 20 30 02 F8 89 FF FC 37 0A 00 10 FF FF'))
    expect(pushed).toHaveLength(0)
  })

  test('hands on a frame as an Actisense string with plainText', () => {
    open({ plainText: true })
    stream.on('data', (d: any) => pushed.push(d))
    port.emit('data', COG_SOG)
    expect(pushed[0]).toMatch(/,2,129026,48,255,8,ff,fc,37,0a,00,10,ff,ff$/)
  })

  test('goes on in Rx All Mode when the gateway refuses CAN Packet Mode, as an NGT-1 does', () => {
    open({}, 2)
    expect(sent()).toContain(SET_CAN_PACKET)
    // The NGT-1 (software 2.690) answers error -1091, giving back mode 5.
    port.emit('data', bem(0x11, 1, Buffer.from([5, 0]), -1091))
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /^actisense: the gateway refused CAN Packet Mode \(error -1091.*\), which only an NGX has; going on in NGT Transfer Rx All Mode$/
      )
    )
    expect(stream.canPacket).toBe(false)
    expect(stream.candevice).toBeUndefined()
    // The CAN device's address claim, held as BST-95, is not sent.
    expect(stream.held).toEqual([])
    // In Rx All Mode it is left alone.
    port.emit('data', modeAnswer(2))
    expect(sent()).not.toContain(SET_RX_ALL)
  })

  test('sets a gateway in yet another mode to Rx All Mode after refusing CAN Packet Mode', () => {
    open({}, 1)
    expect(sent()).toContain(SET_CAN_PACKET)
    port.emit('data', bem(0x11, 1, Buffer.from([5, 0]), -1091))
    // After its restart it says it is in mode 1 still: set to 2 now.
    port.emit('data', modeAnswer(1))
    expect(sent()).toContain(SET_RX_ALL)
  })

  describe('as a CAN device', () => {
    test('claims an address, and sends nothing else until it has', () => {
      open()
      jest.advanceTimersByTime(600)
      sent()
      stream.sendPGN({ pgn: 127250, prio: 2, dst: 255, fields: { heading: 1 } })
      expect(sent()).toEqual([])
      expect(stream.candevice).toBeDefined()
    })

    test('starts claiming only once the gateway is in CAN Packet Mode and settled', () => {
      open({}, 2)
      // Set to 5, and waiting: no claim yet.
      jest.advanceTimersByTime(100)
      expect(stream.candeviceStarted).toBe(false)
      // It says it is in CAN Packet Mode now, and settles.
      port.emit('data', modeAnswer(5))
      jest.advanceTimersByTime(1000)
      expect(stream.candeviceStarted).toBe(true)
    })

    test('claims anew after a reconnect', () => {
      open()
      jest.advanceTimersByTime(1000)
      const first = stream.candevice
      expect(stream.candeviceStarted).toBe(true)
      port.emit('open')
      expect(stream.candevice).not.toBe(first)
      expect(stream.candeviceStarted).toBe(false)
      port.emit('data', modeAnswer(5))
      jest.advanceTimersByTime(1000)
      expect(stream.candeviceStarted).toBe(true)
    })

    test('writes a message as BST-95 frames from its own address, a fast-packet one split', () => {
      open()
      stream.candevice.cansend = true
      stream.candevice.address = 77
      jest.advanceTimersByTime(600)
      sent()
      // 126208, 11 bytes: a fast-packet message of two frames.
      stream.sendPGN({
        pgn: 126208,
        prio: 3,
        dst: 40,
        fields: {
          functionCode: 'Request',
          pgn: 126998,
          numberOfParameters: 0,
          list: []
        }
      })
      const frames = sent()
      expect(frames).toHaveLength(2)
      frames.forEach((f: string) => {
        // 95, L 0e, T 0000, S 4d (77), PDUS 28 (40), PDUF ed, DPPC 8d: to
        // the bus, priority 3, data page 1
        expect(f.slice(4, 20)).toBe('950e00004d28ed8d')
      })
    })

    test('writes an Actisense string as BST-95', () => {
      open()
      stream.candevice.cansend = true
      stream.candevice.address = 77
      jest.advanceTimersByTime(600)
      sent()
      stream.sendString('2026-01-01T00:00:00.000Z,6,59904,0,40,3,14,f0,01')
      // 95, L 09, T 0000, S 4d, PDUS 28, PDUF ea, DPPC 98: to the bus,
      // priority 6; then the data and the checksum.
      expect(sent()).toEqual([
        bdtpEncode(
          Buffer.from(
            [0x95, 0x09, 0, 0, 0x4d, 0x28, 0xea, 0x98, 0x14, 0xf0, 0x01].concat(
              [
                (256 -
                  [0x95, 0x09, 0x4d, 0x28, 0xea, 0x98, 0x14, 0xf0, 0x01].reduce(
                    (a, b) => a + b
                  )) &
                  0xff
              ]
            )
          )
        ).toString('hex')
      ])
    })

    test('does not hand on its own frames coming back from the bus', () => {
      open()
      stream.candevice.cansend = true
      stream.candevice.address = 48
      stream.on('data', (d: any) => pushed.push(d))
      port.emit('data', COG_SOG)
      expect(pushed).toHaveLength(0)
    })
  })
})
