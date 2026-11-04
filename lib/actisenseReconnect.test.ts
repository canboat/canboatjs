// A reconnect after a serial error must close the port before opening the
// device again, or the open fails with "Cannot lock port" (#454).

import { EventEmitter } from 'events'

const locked = new Set<string>()
let opened: any[] = []
let lockErrors: string[] = []
let failCloses = 0

jest.mock('serialport', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter } = require('events')
  class SerialPort extends EventEmitter {
    path: string
    isOpen = false
    constructor({ path }: { path: string }) {
      super()
      this.path = path
      opened.push(this)
      if (locked.has(path)) {
        setImmediate(() => {
          lockErrors.push(path)
          this.emit(
            'error',
            new Error('Error Resource temporarily unavailable Cannot lock port')
          )
        })
      } else {
        locked.add(path)
        this.isOpen = true
      }
    }
    unpipe() {}
    pipe() {}
    written: Buffer[] = []
    write(buf: Buffer) {
      this.written.push(buf)
    }
    closing = false
    // Like serialport 11: isOpen turns false and closing true as soon as a
    // close starts; the lock is released, and the callback called, once
    // the close has completed.
    close(cb?: (err?: Error) => void) {
      this.isOpen = false
      this.closing = true
      setImmediate(() => {
        this.closing = false
        if (failCloses > 0) {
          failCloses--
          this.isOpen = true
          cb && cb(new Error('close failed'))
          return
        }
        this.finishClose()
        cb && cb()
      })
    }
    finishClose() {
      locked.delete(this.path)
      this.closing = false
      this.emit('close')
    }
  }
  return { SerialPort }
})

import { ActisenseStream, composeMessage } from './actisense-serial'

const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setImmediate(r))
  }
}

describe('ActisenseStream reconnect', () => {
  let stream: any
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] })
    locked.clear()
    opened = []
    lockErrors = []
    failCloses = 0
    const app = Object.assign(new EventEmitter(), {
      setProviderStatus: () => undefined,
      setProviderError: () => undefined
    })
    stream = new (ActisenseStream as any)({ device: '/dev/ttyUSB0', app })
  })
  afterEach(() => {
    stream.reconnect = false
    jest.useRealTimers()
  })

  test('closes the port before opening it again', async () => {
    const first = opened[0]
    first.emit('error', new Error('write failed')) // the port stays open
    jest.advanceTimersByTime(5000)
    await settle()
    expect(first.isOpen).toBe(false)
    expect(opened).toHaveLength(2)
    expect(opened[1].isOpen).toBe(true)
    expect(lockErrors).toEqual([])
  })

  test('opens one replacement when an error and a close both ask for it', async () => {
    const first = opened[0]
    first.emit('error', new Error('write failed'))
    first.emit('close')
    jest.advanceTimersByTime(5000)
    await settle()
    jest.advanceTimersByTime(60000)
    await settle()
    expect(opened).toHaveLength(2)
    expect(lockErrors).toEqual([])
  })

  test('tries the close again when it fails, without reopening meanwhile', async () => {
    failCloses = 1
    const first = opened[0]
    first.emit('error', new Error('write failed'))
    jest.advanceTimersByTime(5000)
    await settle()
    expect(first.isOpen).toBe(true) // the close failed
    expect(opened).toHaveLength(1) // and nothing was opened
    jest.advanceTimersByTime(10000)
    await settle()
    expect(first.isOpen).toBe(false)
    expect(opened).toHaveLength(2)
    expect(lockErrors).toEqual([])
  })

  test('waits for a close serialport has started itself', async () => {
    const first = opened[0]
    // serialport is closing the port: no longer open, not yet closed.
    first.isOpen = false
    first.closing = true
    first.emit('error', new Error('device lost'))
    jest.advanceTimersByTime(5000)
    await settle()
    expect(opened).toHaveLength(1) // nothing opened while it closes
    first.finishClose()
    await settle()
    expect(opened).toHaveLength(2)
    expect(opened[1].isOpen).toBe(true)
    expect(lockErrors).toEqual([])
  })

  test('reconnects at the first deadline when an error and a close both ask', async () => {
    const first = opened[0]
    first.emit('error', new Error('write failed'))
    first.emit('close')
    // The first reconnect is 1.5 s out; the close does not push it back.
    jest.advanceTimersByTime(1500)
    await settle()
    expect(opened).toHaveLength(2)
  })

  test('closes again when a close serialport started fails', async () => {
    const first = opened[0]
    first.isOpen = false
    first.closing = true
    first.emit('error', new Error('device lost'))
    jest.advanceTimersByTime(5000)
    await settle()
    // serialport reports the failed close with an error, not a close.
    first.closing = false
    first.isOpen = true
    first.emit('error', new Error('close failed'))
    jest.advanceTimersByTime(20000)
    await settle()
    expect(first.isOpen).toBe(false)
    expect(opened).toHaveLength(2)
    expect(opened[1].isOpen).toBe(true)
    expect(lockErrors).toEqual([])
  })
})

describe('ActisenseStream open (#502, canboat#1134)', () => {
  let stream: any
  let app: any
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] })
    locked.clear()
    opened = []
    app = Object.assign(new EventEmitter(), {
      setProviderStatus: () => undefined,
      setProviderError: () => undefined
    })
    stream = new (ActisenseStream as any)({
      device: '/dev/ttyUSB0',
      app,
      pcode: 'keep'
    })
  })
  afterEach(() => {
    stream.reconnect = false
    stream.end()
    jest.useRealTimers()
  })

  // DLE STX A1 <len> <BEM command> <checksum> DLE ETX
  const GET_PRODUCT_INFO = '1002a101411d1003'
  const GET_MODE = '1002a101114d1003'
  const SET_MODE = '1002a103110200491003'
  const written = (port: any) =>
    port.written.map((b: Buffer) => b.toString('hex'))

  /* A BEM answer of an NGT-1 (model 0x0e, serial 110763). */
  const bem = (id: number, data: string, error = 0) => {
    const header = Buffer.alloc(12)
    header[0] = id
    header.writeUInt16LE(0x0e, 2)
    header.writeUInt32LE(110763, 4)
    header.writeInt32LE(error, 8)
    const payload = Buffer.concat([
      header,
      Buffer.from(data.replace(/ /g, ''), 'hex')
    ])
    return composeMessage(0xa0, payload, payload.length)
  }
  const modeAnswer = (mode: number) =>
    bem(0x11, mode.toString(16).padStart(2, '0') + '00')

  test('asks for Product Info and the operating mode, and sets nothing, with no keepalive', () => {
    const port = opened[0]
    port.emit('open')
    expect(written(port)).toEqual([GET_PRODUCT_INFO, GET_MODE])
    jest.advanceTimersByTime(60000)
    expect(written(port)).toEqual([GET_PRODUCT_INFO, GET_MODE])
  })

  test('a gateway in NGT Transfer Rx All Mode is not set, and output goes out at once', () => {
    const port = opened[0]
    port.emit('open')
    expect(stream.outAvailable).toBe(false)
    port.emit('data', modeAnswer(2))
    expect(stream.gotStartupResponse).toBe(true)
    expect(stream.outAvailable).toBe(true)
    expect(written(port)).not.toContain(SET_MODE)
  })

  test('a gateway in another mode is set once, and output waits for it to settle', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const port = opened[0]
      port.emit('open')
      port.emit('data', modeAnswer(1))
      expect(written(port)).toEqual([GET_PRODUCT_INFO, GET_MODE, SET_MODE])
      expect(stream.outAvailable).toBe(false)
      jest.advanceTimersByTime(499)
      expect(stream.outAvailable).toBe(false)
      jest.advanceTimersByTime(1)
      expect(stream.outAvailable).toBe(true)
      // The answer to the Set, still in the other mode: not set again.
      port.emit('data', modeAnswer(1))
      expect(written(port).filter((w: string) => w === SET_MODE)).toHaveLength(
        1
      )
      expect(warn).toHaveBeenCalledWith(
        'actisense: the gateway is in NGT Transfer Normal Mode, not NGT Transfer Rx All Mode'
      )
    } finally {
      warn.mockRestore()
    }
  })

  test('without an answer, output waits 2 s for the mode', () => {
    opened[0].emit('open')
    jest.advanceTimersByTime(1999)
    expect(stream.outAvailable).toBe(false)
    jest.advanceTimersByTime(1)
    expect(stream.outAvailable).toBe(true)
  })

  test('frames given while output waits are sent in order once it is ready', () => {
    const port = opened[0]
    let available = 0
    app.on('nmea2000OutAvailable', () => available++)
    port.emit('open')
    stream.sendString('2026-01-01T00:00:00.000Z,2,59904,0,255,3,14,f0,01')
    stream.sendString('2026-01-01T00:00:00.000Z,2,59904,0,255,3,00,ee,00')
    expect(written(port)).toEqual([GET_PRODUCT_INFO, GET_MODE])
    port.emit('data', modeAnswer(2))
    const frames = written(port).slice(2)
    expect(frames).toHaveLength(2)
    expect(frames[0]).toContain('14f001')
    expect(frames[1]).toContain('00ee00')
    expect(available).toBe(1)
  })

  test('the mode is asked for again, three times, then warned about', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const port = opened[0]
      port.emit('open')
      // The gateway answers BEM commands, but not Get Operating Mode.
      port.emit('data', bem(0x41, '34 08 27 6e 02 01'))
      jest.advanceTimersByTime(1000)
      jest.advanceTimersByTime(1000)
      jest.advanceTimersByTime(1000)
      expect(written(port).filter((w: string) => w === GET_MODE)).toHaveLength(
        3
      )
      expect(warn).toHaveBeenCalledWith(
        'actisense: the gateway does not report its operating mode; not reading its transmit list'
      )
    } finally {
      warn.mockRestore()
    }
  })

  describe('a gateway that restarts (#503, canboat#1134)', () => {
    // Startup Status, firmware 2.690 (0x0a82), then the reset status.
    const startupStatus = (data: string) => bem(0xf0, data)
    let warn: jest.SpyInstance
    beforeEach(() => {
      warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    })
    afterEach(() => warn.mockRestore())

    test('is read again, not set, and output waits for it', () => {
      const port = opened[0]
      port.emit('open')
      port.emit('data', modeAnswer(2))
      expect(stream.outAvailable).toBe(true)
      port.written = []

      port.emit('data', startupStatus('82 0a 01 00 00 00'))
      expect(warn).toHaveBeenCalledWith(
        'actisense: the gateway restarted (firmware 2.690, reset status 0x1); reading its settings again'
      )
      expect(written(port)).toEqual([GET_PRODUCT_INFO, GET_MODE])
      expect(stream.outAvailable).toBe(false)
      // The mode is in at once, but the gateway is still starting.
      port.emit('data', modeAnswer(2))
      jest.advanceTimersByTime(499)
      expect(stream.outAvailable).toBe(false)
      jest.advanceTimersByTime(1)
      expect(stream.outAvailable).toBe(true)
      expect(written(port)).not.toContain(SET_MODE)
    })

    test('after our Set Operating Mode is expected, and does not set it again', () => {
      const port = opened[0]
      port.emit('open')
      port.emit('data', modeAnswer(1))
      jest.advanceTimersByTime(150)
      port.emit('data', startupStatus('82 0a 0b 00 00 00'))
      expect(warn).not.toHaveBeenCalled()
      port.emit('data', modeAnswer(2))
      jest.advanceTimersByTime(60000)
      expect(written(port).filter((w: string) => w === SET_MODE)).toHaveLength(
        1
      )
      expect(stream.outAvailable).toBe(true)
    })

    test("old firmware's one-byte reset status is read", () => {
      opened[0].emit('open')
      opened[0].emit('data', startupStatus('82 0a 04'))
      expect(warn).toHaveBeenCalledWith(
        'actisense: the gateway restarted (firmware 2.690, reset status 0x4); reading its settings again'
      )
    })
  })
})
