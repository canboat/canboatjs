// The NGT-1's Transmit PGN Enable list sync (#504), on with
// ENABLESETTRANSMITPGNS, fed the answers of a real NGT-1-USB with firmware
// 2.690 (canboat samples/actisense-ngt1-fw2690.txt).

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

const hex = (s: string) => Buffer.from(s.replace(/ /g, ''), 'hex')

/* An NGT_MSG_RECEIVED frame carrying a BEM answer. */
const received = (payload: string) => {
  const p = hex(payload)
  return composeMessage(0xa0, p, p.length)
}

/* The BEM header of that NGT-1: sequence, model id 0x0e, serial 110763,
   then the error code. */
const header = (bem: number, sequence: number, error = 0) => {
  const h = Buffer.alloc(12)
  h[0] = bem
  h[1] = sequence
  h.writeUInt16LE(0x0e, 2)
  h.writeUInt32LE(110763, 4)
  h.writeInt32LE(error, 8)
  return h.toString('hex')
}

/* An NGT_MSG_SEND command, as written to the gateway. */
const command = (payload: string) => {
  const p = hex(payload)
  return composeMessage(0xa1, p, p.length).toString('hex')
}

const MODE_ANSWER = '11 01 0e 00 ab b0 01 00 00 00 00 00 02 00'

const PRODUCT_INFO = [
  '41 01 0e 00 ab b0 01 00 00 00 00 00 34 08 27 6e 02 01',
  '41 02 0e 00 ab b0 01 00 00 00 00 00 4e 4d 45 41 20 32 30 30 30 20 50 43 20 49 6e 74 65 72 66 61 63 65 20 28 4e 47 54 2d 31 29 ff ff',
  '41 03 0e 00 ab b0 01 00 00 00 00 00 31 2e 31 30 30 2c 20 32 2e 36 39 30 ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff',
  '41 04 0e 00 ab b0 01 00 00 00 00 00 4e 47 54 2d 31 2d 55 53 42 20 20 5b 35 5d ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff',
  '41 05 0e 00 ab b0 01 00 00 00 00 00 31 31 30 37 36 33 ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff'
]

/* Its Supported PGN List, highest index first, as it sent it. */
const SUPPORTED = [
  '40 01 0e 00 ab b0 01 00 00 00 00 00 00 00 11 00 00 34 08 a3 90 13 90 14 fd 01 91 00 fe 01 92 07 fe 01 93 09 fe 01 94 0a fe 01 95 0b fe 01 96 0c fe 01 97 0d fe 01 98 0e fe 01 99 10 fe 01 9a 11 fe 01 9b 12 fe 01 9c 14 fe 01 9d 15 fe 01 9e 16 fe 01 9f 17 fe 01 a0 18 fe 01 a1 19 fe 01 a2 00 ff 01',
  '40 01 0e 00 ab b0 01 00 00 00 00 00 00 00 11 00 00 34 08 a3 60 30 60 02 fb 01 61 03 fb 01 62 04 fb 01 63 05 fb 01 64 06 fb 01 65 07 fb 01 66 08 fb 01 67 09 fb 01 68 0a fb 01 69 0b fb 01 6a 0c fb 01 6b 0d fb 01 6c 0e fb 01 6d 0f fb 01 6e 10 fb 01 6f 11 fb 01 70 12 fb 01 71 13 fb 01 72 14 fb 01 73 15 fb 01 74 04 fc 01 75 05 fc 01 76 06 fc 01 77 0c fc 01 78 0d fc 01 79 10 fc 01 7a 11 fc 01 7b 12 fc 01 7c 13 fc 01 7d 14 fc 01 7e 15 fc 01 7f 16 fc 01 80 17 fc 01 81 18 fc 01 82 19 fc 01 83 1a fc 01 84 02 fd 01 85 06 fd 01 86 07 fd 01 87 08 fd 01 88 09 fd 01 89 0a fd 01 8a 0b fd 01 8b 0c fd 01 8c 10 fd 01 8d 11 fd 01 8e 12 fd 01 8f 13 fd 01',
  '40 01 0e 00 ab b0 01 00 00 00 00 00 00 00 11 00 00 34 08 a3 30 30 30 17 f2 01 31 18 f2 01 32 19 f2 01 33 1a f2 01 34 00 f3 01 35 01 f3 01 36 02 f3 01 37 03 f3 01 38 04 f3 01 39 05 f3 01 3a 06 f3 01 3b 07 f3 01 3c 03 f5 01 3d 0b f5 01 3e 13 f5 01 3f 08 f6 01 40 01 f8 01 41 02 f8 01 42 03 f8 01 43 04 f8 01 44 05 f8 01 45 09 f8 01 46 0e f8 01 47 0f f8 01 48 10 f8 01 49 11 f8 01 4a 14 f8 01 4b 15 f8 01 4c 03 f9 01 4d 04 f9 01 4e 05 f9 01 4f 0b f9 01 50 15 f9 01 51 16 f9 01 52 02 fa 01 53 03 fa 01 54 04 fa 01 55 05 fa 01 56 06 fa 01 57 09 fa 01 58 0a fa 01 59 0b fa 01 5a 0d fa 01 5b 0e fa 01 5c 0f fa 01 5d 14 fa 01 5e 00 fb 01 5f 01 fb 01',
  '40 01 0e 00 ab b0 01 00 00 00 00 00 00 00 11 00 00 34 08 a3 00 30 00 00 00 00 01 00 e8 00 02 00 ea 00 03 00 eb 00 04 00 ec 00 05 00 ee 00 06 00 ef 00 07 00 f0 00 08 d8 fe 00 09 00 ff 00 0a 00 ed 01 0b 00 ee 01 0c 00 ef 01 0d 07 f0 01 0e 08 f0 01 0f 09 f0 01 10 0a f0 01 11 0b f0 01 12 0c f0 01 13 10 f0 01 14 11 f0 01 15 14 f0 01 16 16 f0 01 17 01 f1 01 18 05 f1 01 19 0d f1 01 1a 12 f1 01 1b 13 f1 01 1c 14 f1 01 1d 19 f1 01 1e 1a f1 01 1f 00 f2 01 20 01 f2 01 21 05 f2 01 22 08 f2 01 23 09 f2 01 24 0a f2 01 25 0c f2 01 26 0d f2 01 27 0e f2 01 28 0f f2 01 29 10 f2 01 2a 11 f2 01 2b 12 f2 01 2c 13 f2 01 2d 14 f2 01 2e 15 f2 01 2f 16 f2 01'
]

/* Its Tx PGN Enable List F2, the proprietary part first: 12 standard PGNs,
   and the proprietary 65286, 130822 and 130847. */
const F2 = [
  '4f 02 0e 00 ab b0 01 00 00 00 00 00 01 03 11 00 00 20 40 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 20 40 00 00 80 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00',
  '4f 01 0e 00 ab b0 01 00 00 00 00 00 01 02 11 00 00 0c 00 0c 01 06 ff ff 02 06 ff ff 03 06 ff ff 04 06 ff ff 05 06 ff ff 06 07 ff ff 0a 03 ff ff 0b 06 ff ff 0c 07 ff ff 14 07 60 ea 15 06 ff ff 16 06 ff ff'
]

/* Its Tx PGN Enable List F1: 12 PGNs, 65286 in place of 126998, and no
   130822 or 130847. */
const F1 = [
  '49 01 0e 00 ab b0 01 00 00 00 00 00 0c 00 e8 00 00 00 ea 00 00 00 eb 00 00 00 ec 00 00 00 ee 00 00 00 ef 00 00 06 ff 00 00 00 ed 01 00 00 ee 01 00 00 ef 01 00 11 f0 01 00 14 f0 01 00',
  '49 02 0e 00 ab b0 01 00 00 00 00 00 0c ff ff 00 00 ff ff 00 00 ff ff 00 00 ff ff 00 00 ff ff 00 00 ff ff 00 00 ff ff 00 00 ff ff 00 00 ff ff 00 00 ff ff 00 00 60 ea 00 00 ff ff 00 00',
  '49 03 0e 00 ab b0 01 00 00 00 00 00 0c 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00',
  '49 04 0e 00 ab b0 01 00 00 00 00 00 0c 06 06 06 06 06 07 07 03 06 07 07 06'
]

const READ_F1 = command('49')
const READ_F2 = [command('40'), command('4f')]
const COMMIT = command('01')
const ACTIVATE = command('4b')

/* Set Tx PGN Enable: PGN, enable, rate and timeout 0xfffffffe. */
const enable = (pgn: number) => {
  const p = Buffer.alloc(4)
  p.writeUInt32LE(pgn)
  return command('47' + p.toString('hex') + '01 fe ff ff ff fe ff ff ff')
}

/* The gateway's answer to it: `error` 0 added, -996 already there. */
const enabled = (pgn: number, error: number) => {
  const p = Buffer.alloc(4)
  p.writeUInt32LE(pgn)
  return header(0x47, 1, error) + p.toString('hex') + '01ffff0000000000000007'
}

describe('the transmit PGN list sync (#504)', () => {
  let stream: any
  let port: any
  let warn: jest.SpyInstance
  beforeEach(() => {
    jest.useFakeTimers()
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    process.env.ENABLESETTRANSMITPGNS = '1'
    opened = []
    const app = Object.assign(new EventEmitter(), {
      setProviderStatus: () => undefined,
      setProviderError: () => undefined
    })
    stream = new (ActisenseStream as any)({ device: '/dev/ttyUSB0', app })
    port = opened[0]
  })
  afterEach(() => {
    delete process.env.ENABLESETTRANSMITPGNS
    stream.end()
    warn.mockRestore()
    jest.useRealTimers()
  })

  const receive = (...payloads: string[]) => {
    for (const p of payloads) {
      port.emit('data', received(p))
    }
  }
  /* Open with `wanted`, answer Product Info if `withFirmware`, and the
     mode; return what is written once the list read is due. */
  const openAndRead = (wanted: number[], withFirmware = true) => {
    stream.transmitPGNs = wanted
    port.emit('open')
    if (withFirmware) {
      receive(...PRODUCT_INFO)
    }
    receive(MODE_ANSWER)
    port.written = []
    jest.advanceTimersByTime(1999)
    expect(port.written).toEqual([])
    jest.advanceTimersByTime(1)
    return sent()
  }
  const sent = () => {
    const out = port.written.map((b: Buffer) => b.toString('hex'))
    port.written = []
    return out
  }

  test('firmware 2.690 is read with F2, which shows PGNs F1 cannot: nothing is written', () => {
    expect(openAndRead([126998, 130847])).toEqual(READ_F2)
    expect(stream.outAvailable).toBe(false)
    receive(...SUPPORTED, ...F2)
    expect(sent()).toEqual([])
    expect(stream.outAvailable).toBe(true)
  })

  test('a missing PGN is enabled, saved and activated', () => {
    openAndRead([130847, 127508])
    receive(...SUPPORTED, ...F2)
    // The bytes canboatjs has always sent: PGN, enable, rate and timeout.
    expect(sent()).toEqual([
      command('47 14 f2 01 00 01 fe ff ff ff fe ff ff ff')
    ])
    receive(enabled(127508, 0))
    expect(sent()).toEqual([COMMIT])
    receive(header(0x01, 1))
    expect(sent()).toEqual([ACTIVATE])
    expect(stream.outAvailable).toBe(false)
    receive(header(0x4b, 1))
    expect(stream.outAvailable).toBe(true)
  })

  test('an enable answered "already enabled" saves nothing', () => {
    // Unknown firmware is read with F1, which does not show 126998.
    expect(openAndRead([126998], false)).toEqual([READ_F1])
    receive(...F1)
    expect(sent()).toEqual([enable(126998)])
    receive(enabled(126998, -996))
    expect(sent()).toEqual([])
    expect(stream.outAvailable).toBe(true)
  })

  test('a refused PGN is warned about and does not stop the rest', () => {
    openAndRead([127508, 127506])
    receive(...SUPPORTED, ...F2)
    expect(sent()).toEqual([enable(127508)])
    // The status byte is 1 here too: only the error code tells.
    receive(enabled(127508, -997))
    expect(warn).toHaveBeenCalledWith(
      'actisense: the gateway refused transmit PGN 127508: error -997'
    )
    expect(sent()).toEqual([enable(127506)])
    receive(enabled(127506, 0))
    expect(sent()).toEqual([COMMIT])
  })

  test('a PDU1 PGN is compared with its destination byte cleared', () => {
    // 126721 is stored as 126720, which the gateway has.
    openAndRead([126721])
    receive(...SUPPORTED, ...F2)
    expect(sent()).toEqual([])
    expect(stream.outAvailable).toBe(true)
  })

  test('a refused F2 read falls back to F1', () => {
    openAndRead([127508])
    receive(header(0x4f, 1, -1139))
    expect(sent()).toEqual([READ_F1])
  })

  test('an unanswered F2 read is retried, then read with F1', () => {
    openAndRead([127508])
    jest.advanceTimersByTime(10000)
    expect(sent()).toEqual(READ_F2)
    jest.advanceTimersByTime(10000)
    expect(sent()).toEqual(READ_F2)
    jest.advanceTimersByTime(10000)
    expect(sent()).toEqual([READ_F1])
  })

  test('an unanswered F1 read is given up, and output let through', () => {
    openAndRead([127508], false)
    jest.advanceTimersByTime(30000)
    expect(sent()).toEqual([READ_F1, READ_F1])
    expect(warn).toHaveBeenCalledWith(
      'actisense: could not read the transmit PGN list'
    )
    expect(stream.outAvailable).toBe(true)
  })
})
