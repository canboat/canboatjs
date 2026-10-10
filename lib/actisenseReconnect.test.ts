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

import { ActisenseStream } from './actisense-serial'

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

describe('ActisenseStream open (#502)', () => {
  let stream: any
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] })
    locked.clear()
    opened = []
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

  test('asks for Product Info, then sets NGT Transfer Rx All Mode, with no keepalive', () => {
    const port = opened[0]
    port.emit('open')
    // DLE STX A1 <len> <BEM command> <checksum> DLE ETX
    expect(port.written.map((b: Buffer) => b.toString('hex'))).toEqual([
      '1002a101411d1003', // Get Product Info
      '1002a103110200491003' // Set Operating Mode, mode 2
    ])
    jest.advanceTimersByTime(60000)
    expect(port.written).toHaveLength(2)
  })

  test('the mode answer, arriving while output waits, asks for no transmit list', () => {
    const port = opened[0]
    port.emit('open')
    // The fw 2.690 NGT-1's answer: NGT Transfer Rx All Mode.
    port.emit(
      'data',
      Buffer.from('1002a00e11010e00abb00100000000000200d41003', 'hex')
    )
    expect(stream.gotStartupResponse).toBe(true)
    jest.advanceTimersByTime(60000)
    expect(port.written).toHaveLength(2)
    expect(stream.outAvailable).toBe(true)
  })

  test('output waits for the gateway to settle after Set Operating Mode', () => {
    opened[0].emit('open')
    expect(stream.outAvailable).toBe(false)
    jest.advanceTimersByTime(499)
    expect(stream.outAvailable).toBe(false)
    jest.advanceTimersByTime(1)
    expect(stream.outAvailable).toBe(true)
  })

  describe('a gateway that restarts (#503)', () => {
    // Startup Status of an NGT-1 (model 0x0e, serial 110763), firmware
    // 2.690 (0x0a82), reset status 1: framed, with its checksum.
    const startupStatus = (data: string) => {
      const payload = Buffer.from(
        ('f0 00 0e 00 ab b0 01 00 00 00 00 00 ' + data).replace(/ /g, ''),
        'hex'
      )
      let sum = 0xa0 + payload.length
      payload.forEach((b) => (sum += b))
      return Buffer.concat([
        Buffer.from([0x10, 0x02, 0xa0, payload.length]),
        payload,
        Buffer.from([(256 - (sum % 256)) % 256, 0x10, 0x03])
      ])
    }
    let warn: jest.SpyInstance
    beforeEach(() => {
      warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    })
    afterEach(() => warn.mockRestore())

    test('is set up again, and output waits for it to settle', () => {
      const port = opened[0]
      port.emit('open')
      jest.advanceTimersByTime(500)
      expect(stream.outAvailable).toBe(true)
      port.written = []

      port.emit('data', startupStatus('82 0a 01 00 00 00'))
      expect(warn).toHaveBeenCalledWith(
        'actisense: the gateway restarted (firmware 2.690, reset status 0x1); setting it up again'
      )
      expect(port.written.map((b: Buffer) => b.toString('hex'))).toEqual([
        '1002a101411d1003',
        '1002a103110200491003'
      ])
      expect(stream.outAvailable).toBe(false)
      jest.advanceTimersByTime(500)
      expect(stream.outAvailable).toBe(true)
    })

    test("old firmware's one-byte reset status is read", () => {
      opened[0].emit('open')
      opened[0].emit('data', startupStatus('82 0a 04'))
      expect(warn).toHaveBeenCalledWith(
        'actisense: the gateway restarted (firmware 2.690, reset status 0x4); setting it up again'
      )
    })
  })
})
