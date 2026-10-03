// A transport must take its handlers off the server's app when it ends,
// and must not add more on every reconnect (#431).

import { EventEmitter } from 'events'

jest.mock('serialport', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter } = require('events')
  class SerialPort extends EventEmitter {
    unpipe() {}
    pipe() {}
    write() {}
    close() {
      this.emit('close')
    }
  }
  return { SerialPort }
})

import { subscribeApp, unsubscribeApp } from './utilities'
import { ActisenseStream } from './actisense-serial'
import { Ydgw02Stream } from './ydgw02'

const outListeners = (app: EventEmitter) =>
  app.listenerCount('nmea2000out') + app.listenerCount('nmea2000JsonOut')

describe('subscribeApp / unsubscribeApp', () => {
  test('removes exactly the handlers it added', () => {
    const app = new EventEmitter()
    const other = () => undefined
    app.on('nmea2000out', other)
    const owner = {}
    subscribeApp(owner, app, 'nmea2000out', () => undefined)
    subscribeApp(owner, app, 'nmea2000JsonOut', () => undefined)
    expect(outListeners(app)).toBe(3)
    unsubscribeApp(owner)
    expect(app.listeners('nmea2000out')).toEqual([other])
    expect(app.listenerCount('nmea2000JsonOut')).toBe(0)
    unsubscribeApp(owner) // twice is harmless
  })
})

describe('ActisenseStream', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  test('a reconnect replaces its handlers instead of adding more', () => {
    const app = Object.assign(new EventEmitter(), {
      setProviderStatus: () => undefined,
      setProviderError: () => undefined
    })
    const stream: any = new (ActisenseStream as any)({
      device: '/dev/null',
      app
    })
    expect(outListeners(app)).toBe(2)
    stream.serial.emit('close') // the port drops: reconnect later
    jest.advanceTimersByTime(120 * 1000)
    stream.serial.emit('close')
    jest.advanceTimersByTime(120 * 1000)
    expect(outListeners(app)).toBe(2)
  })

  test('end() takes its handlers off and does not reconnect', () => {
    const app = Object.assign(new EventEmitter(), {
      setProviderStatus: () => undefined,
      setProviderError: () => undefined
    })
    const stream: any = new (ActisenseStream as any)({
      device: '/dev/null',
      app
    })
    stream.end() // closing fires 'close'
    jest.advanceTimersByTime(120 * 1000)
    expect(outListeners(app)).toBe(0)
  })
})

describe('Ydgw02Stream', () => {
  test('end() takes its handlers off', () => {
    const app = new EventEmitter()
    const stream: any = new (Ydgw02Stream as any)({ app }, 'network')
    expect(outListeners(app) + app.listenerCount('ydFullRawOut')).toBe(3)
    stream.end()
    expect(outListeners(app) + app.listenerCount('ydFullRawOut')).toBe(0)
  })
})
