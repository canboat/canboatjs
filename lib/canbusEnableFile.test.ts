// CanbusStream's enableFile: the port is read only while the file's first
// line is `on`.

import { EventEmitter } from 'events'
import fs from 'fs'
import os from 'os'
import path from 'path'

const mockChannels: { device: string; stopped: boolean }[] = []

jest.mock('./canSocket', () => ({
  CAN_RAW_FILTER_MAX: 512,
  CanChannel: class extends (jest.requireActual('events').EventEmitter as any) {
    excludedPgns = []
    record = { device: '', stopped: false }
    constructor(device: string) {
      super()
      this.record.device = device
      mockChannels.push(this.record)
    }
    start() {}
    stop() {
      this.record.stopped = true
    }
    send() {}
  }
}))

jest.mock('./candevice', () => ({
  CanDevice: class {
    start() {}
    stop() {}
  }
}))

// The stat poll is libuv's, not a JS timer: the test fires its callbacks.
const mockWatching: Record<string, Set<() => void>> = {}
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  watchFile: (file: string, _options: any, cb: () => void) => {
    ;(mockWatching[file] ??= new Set()).add(cb)
  },
  // Without a listener, Node removes them all.
  unwatchFile: (file: string, cb?: () => void) => {
    cb ? mockWatching[file]?.delete(cb) : delete mockWatching[file]
  }
}))

import { CanbusStream } from './canbus'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canbus-enable-'))
const file = path.join(dir, 'enable')
const write = (content: string) => fs.writeFileSync(file, content)

const newStream = (options = {}) => {
  const app = Object.assign(new EventEmitter(), {
    setProviderStatus: jest.fn(),
    setProviderError: jest.fn()
  })
  const stream = new (CanbusStream as any)({
    app,
    canDevice: 'can1',
    enableFile: file,
    ...options
  })
  return { stream, app }
}
const status = (app: any) => app.setProviderStatus.mock.calls.at(-1)[1]
const open = () => mockChannels.filter((c) => !c.stopped).length
const fire = () => mockWatching[file]?.forEach((cb) => cb())
const watchers = () => mockWatching[file]?.size ?? 0

beforeEach(() => {
  mockChannels.length = 0
  fs.rmSync(file, { force: true })
})

afterAll(() => fs.rmSync(dir, { recursive: true }))

describe('CanbusStream enableFile', () => {
  const cases: [string, string | undefined, number, string][] = [
    ['on', 'on\n', 1, 'Connected to CAN bus'],
    ['on without a newline', 'on', 1, 'Connected to CAN bus'],
    [
      'off with a reason',
      'off\nOff: not a VE.Can profile\n',
      0,
      'Off: not a VE.Can profile'
    ],
    ['on with a CRLF', 'on\r\n', 1, 'Connected to CAN bus'],
    ['off without a reason', 'off\n', 0, 'Off'],
    ['empty', '', 0, 'Off'],
    ['no file', undefined, 0, 'Off']
  ]
  test.each(cases)('%s', (_name, content, channelsOpen, text) => {
    if (content !== undefined) {
      write(content)
    }
    const { stream, app } = newStream()
    expect(open()).toBe(channelsOpen)
    expect(status(app)).toBe(text)
    stream.end()
  })

  test('without the option the port is read as always', () => {
    const { stream, app } = newStream({ enableFile: undefined })
    expect(open()).toBe(1)
    expect(status(app)).toBe('Connected to CAN bus')
    expect(watchers()).toBe(0)
    stream.end()
  })

  test('follows the file: off closes without reconnecting, on opens anew', () => {
    write('on\n')
    const { stream, app } = newStream()
    const first = mockChannels[0]

    write('off\nOff: switched off\n')
    fire()
    expect(first.stopped).toBe(true)
    expect(open()).toBe(0)
    expect(status(app)).toBe('Off: switched off')
    expect(app.setProviderError).not.toHaveBeenCalled()

    write('on\n')
    fire()
    expect(open()).toBe(1)
    expect(status(app)).toBe('Connected to CAN bus')

    // Written again with the same content: the interface may have been
    // down and up, after which the old socket stays silent.
    write('on\n')
    fire()
    expect(mockChannels).toHaveLength(3)
    expect(open()).toBe(1)

    stream.end()
    expect(open()).toBe(0)
    expect(watchers()).toBe(0)
  })

  test('ending one stream leaves the watch of another on the same file', () => {
    write('on\n')
    const first = newStream()
    const second = newStream()
    first.stream.end()
    write('off\nOff: switched off\n')
    fire()
    expect(status(second.app)).toBe('Off: switched off')
    second.stream.end()
  })
})
