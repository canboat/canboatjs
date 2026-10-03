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
    // Like serialport: the lock is released, and the callback called, once
    // the close has completed.
    close(cb?: (err?: Error) => void) {
      setImmediate(() => {
        if (failCloses > 0) {
          failCloses--
          cb && cb(new Error('close failed'))
          return
        }
        locked.delete(this.path)
        this.isOpen = false
        this.emit('close')
        cb && cb()
      })
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
})
