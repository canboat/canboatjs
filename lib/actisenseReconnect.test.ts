// A reconnect after a serial error must close the port before opening the
// device again, or the open fails with "Cannot lock port" (#454).

import { EventEmitter } from 'events'

const locked = new Set<string>()
const opened: any[] = []
const lockErrors: string[] = []

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
    close(cb?: () => void) {
      locked.delete(this.path)
      this.isOpen = false
      setImmediate(() => {
        this.emit('close')
        cb && cb()
      })
    }
  }
  return { SerialPort }
})

import { ActisenseStream } from './actisense-serial'

test('a reconnect after an error closes the port before opening it again', async () => {
  jest.useFakeTimers({ doNotFake: ['setImmediate'] })
  const app = Object.assign(new EventEmitter(), {
    setProviderStatus: () => undefined,
    setProviderError: () => undefined
  })
  const stream: any = new (ActisenseStream as any)({
    device: '/dev/ttyUSB0',
    app
  })
  const first = opened[0]
  expect(first.isOpen).toBe(true)

  first.emit('error', new Error('write failed')) // the port stays open
  jest.advanceTimersByTime(5000) // the reconnect delay
  await new Promise((r) => setImmediate(r)) // the old port closes
  await new Promise((r) => setImmediate(r))

  expect(first.isOpen).toBe(false)
  expect(opened).toHaveLength(2)
  expect(opened[1].isOpen).toBe(true)
  expect(lockErrors).toEqual([])
  stream.reconnect = false
  jest.useRealTimers()
})
