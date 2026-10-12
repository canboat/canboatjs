// CanChannel's writes: a frame the kernel turns away because the
// interface's transmit queue is full is written again, in order (#510).

import { constants } from 'os'

/* A fake kernel: takes `room` frames, then refuses with ENOBUFS until the
   "bus" has taken them (drain()). */
const kernel = {
  room: 10,
  queued: 0,
  sent: [] as number[],
  refusals: 0
}

jest.mock(
  '../build/Release/canSocket.node',
  () => ({
    openCanReadSocket: () => 100,
    openCanWriteSocket: () => 101,
    readCanFrames: () => [],
    CanPoller: class {
      close() {}
    },
    writeCanFrame: (_fd: number, frame: Buffer) => {
      if (kernel.queued >= kernel.room) {
        kernel.refusals++
        return -constants.errno.ENOBUFS
      }
      kernel.queued++
      kernel.sent.push(frame[8])
      return frame.length
    }
  }),
  { virtual: true }
)

jest.mock('fs', () => ({ ...jest.requireActual('fs'), closeSync: () => {} }))

import { CanChannel } from './canSocket'

/* The bus takes every queued frame. */
const drain = () => {
  kernel.queued = 0
}

describe('CanChannel send', () => {
  let channel: CanChannel
  beforeEach(() => {
    jest.useFakeTimers()
    Object.assign(kernel, { room: 10, queued: 0, sent: [], refusals: 0 })
    channel = new CanChannel('can0')
  })
  afterEach(() => {
    channel.stop()
    jest.useRealTimers()
  })

  /* 20 frames, as Product Information (126996) takes, numbered in their
     first data byte. */
  const sendFrames = (n: number) => {
    for (let i = 0; i < n; i++) {
      channel.send({ id: 0x19f01400, ext: true, data: Buffer.from([i]) })
    }
  }

  test('frames the kernel turns away are written later, in order', () => {
    sendFrames(20)
    expect(kernel.sent).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(kernel.refusals).toBe(1)

    drain()
    jest.advanceTimersByTime(2)
    expect(kernel.sent).toHaveLength(20)
    expect(kernel.sent).toEqual([...Array(20).keys()])
  })

  test('a frame sent while others wait goes after them', () => {
    sendFrames(12)
    channel.send({ id: 0x9f80103, ext: true, data: Buffer.from([99]) })
    expect(kernel.sent).toHaveLength(10)
    drain()
    jest.advanceTimersByTime(2)
    expect(kernel.sent.slice(10)).toEqual([10, 11, 99])
  })

  test('the wait goes on while the bus takes nothing', () => {
    sendFrames(11)
    jest.advanceTimersByTime(20)
    expect(kernel.sent).toHaveLength(10)
    drain()
    jest.advanceTimersByTime(2)
    expect(kernel.sent).toHaveLength(11)
  })

  test('past 512 waiting frames, newer ones are dropped and reported', () => {
    const errors: string[] = []
    channel.on('onError', (msg: string) => errors.push(msg))
    kernel.room = 0
    sendFrames(600)
    kernel.room = 1000
    jest.advanceTimersByTime(2)
    expect(kernel.sent).toHaveLength(512)
    expect(errors).toEqual(['CAN transmit queue full: dropped 88 frame(s)'])
  })

  test('while the bus stays blocked, drops are reported every 5 s', () => {
    const errors: string[] = []
    channel.on('onError', (msg: string) => errors.push(msg))
    kernel.room = 0
    sendFrames(600)
    jest.advanceTimersByTime(2)
    expect(errors).toEqual(['CAN transmit queue full: dropped 88 frame(s)'])
    sendFrames(10)
    jest.advanceTimersByTime(4000)
    expect(errors).toHaveLength(1)
    jest.advanceTimersByTime(1000)
    expect(errors).toEqual([
      'CAN transmit queue full: dropped 88 frame(s)',
      'CAN transmit queue full: dropped 10 frame(s)'
    ])
    expect(kernel.sent).toHaveLength(0)
  })

  test('stop() drops what is waiting', () => {
    sendFrames(15)
    channel.stop()
    drain()
    jest.advanceTimersByTime(10)
    expect(kernel.sent).toHaveLength(10)
  })
})
