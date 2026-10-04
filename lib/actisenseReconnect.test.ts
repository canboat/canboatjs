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
    write() {}
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
