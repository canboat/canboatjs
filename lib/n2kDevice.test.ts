// Unit tests for N2kDevice address claim option mapping.

jest.mock('./persist', () => ({
  getPersistedData: jest.fn(() => undefined),
  savePersistedData: jest.fn()
}))

import { CanDevice } from './candevice'

function makeOptions(overrides: Record<string, unknown> = {}) {
  return {
    // app is required for CanDevice to register its analyzer listener.
    // Use a minimal stub so the constructor doesn't blow up.
    app: { on: () => undefined, removeListener: () => undefined },
    providerId: 'test',
    uniqueNumber: 12345,
    ...overrides
  }
}

describe('N2kDevice address claim options', () => {
  // Hoisted so afterEach can stop the device created in each test even
  // if the test body throws — otherwise a failing assertion leaks the
  // addressClaimChecker / heartbeatInterval into the next test run.
  let dev: CanDevice | undefined

  afterEach(() => {
    if (dev) {
      dev.stop()
      dev = undefined
    }
  })

  test('caller-supplied addressClaim with legacy top-level uniqueNumber is honored', () => {
    // Older callers passed an addressClaim object with `uniqueNumber`
    // (or the human-readable `'Unique Number'`) at the top level.
    // The encoder ignores both and reads `.fields.uniqueNumber` only,
    // so we promote the legacy value into `.fields` rather than letting
    // options.uniqueNumber / persistence silently overwrite it.
    const legacyClaim: any = { uniqueNumber: 7777777 }
    dev = new CanDevice(
      { sendPGN: () => undefined },
      makeOptions({
        addressClaim: legacyClaim,
        uniqueNumber: 1111111 // would otherwise win
      })
    )
    const ac: any = dev.addressClaim
    expect(ac.fields.uniqueNumber).toBe(7777777)
  })

  test("caller-supplied addressClaim with legacy 'Unique Number' key is honored", () => {
    // Same fallback as the previous test, but supplied via the
    // human-readable key the canboat JSON uses. Exercises the
    // `ac['Unique Number']` arm of the `??` chain.
    const legacyClaim: any = { 'Unique Number': 9999999 }
    dev = new CanDevice(
      { sendPGN: () => undefined },
      makeOptions({
        addressClaim: legacyClaim,
        uniqueNumber: 1111111 // would otherwise win
      })
    )
    const ac: any = dev.addressClaim
    expect(ac.fields.uniqueNumber).toBe(9999999)
  })

  test('caller-supplied addressClaim with .fields.uniqueNumber is honored', () => {
    const claim: any = { fields: { uniqueNumber: 8888888 } }
    dev = new CanDevice(
      { sendPGN: () => undefined },
      makeOptions({
        addressClaim: claim,
        uniqueNumber: 2222222 // would otherwise win
      })
    )
    const ac: any = dev.addressClaim
    expect(ac.fields.uniqueNumber).toBe(8888888)
  })

  test('uniqueNumber from options lands on addressClaim.fields (not top-level)', () => {
    dev = new CanDevice(
      { sendPGN: () => undefined },
      makeOptions({ uniqueNumber: 1150522 })
    )
    const ac: any = dev.addressClaim
    expect(ac.fields.uniqueNumber).toBe(1150522)
  })

  test('defaults: deviceInstanceLower=0, deviceInstanceUpper=0, systemInstance=0', () => {
    dev = new CanDevice({ sendPGN: () => undefined }, makeOptions())
    const ac: any = dev.addressClaim
    expect(ac.fields.deviceInstanceLower).toBe(0)
    expect(ac.fields.deviceInstanceUpper).toBe(0)
    expect(ac.fields.systemInstance).toBe(0)
  })

  test('combined deviceInstance = 5 → lower=5, upper=0', () => {
    dev = new CanDevice(
      { sendPGN: () => undefined },
      makeOptions({ deviceInstance: 5 })
    )
    const ac: any = dev.addressClaim
    expect(ac.fields.deviceInstanceLower).toBe(5)
    expect(ac.fields.deviceInstanceUpper).toBe(0)
  })

  test('combined deviceInstance = 12 → lower=4, upper=1', () => {
    // 12 = (1<<3) | 4
    dev = new CanDevice(
      { sendPGN: () => undefined },
      makeOptions({ deviceInstance: 12 })
    )
    const ac: any = dev.addressClaim
    expect(ac.fields.deviceInstanceLower).toBe(4)
    expect(ac.fields.deviceInstanceUpper).toBe(1)
  })

  test('combined deviceInstance = 255 → lower=7, upper=31', () => {
    dev = new CanDevice(
      { sendPGN: () => undefined },
      makeOptions({ deviceInstance: 255 })
    )
    const ac: any = dev.addressClaim
    expect(ac.fields.deviceInstanceLower).toBe(7)
    expect(ac.fields.deviceInstanceUpper).toBe(31)
  })

  test('explicit deviceInstanceLower / deviceInstanceUpper override combined', () => {
    dev = new CanDevice(
      { sendPGN: () => undefined },
      makeOptions({
        deviceInstance: 0, // would split to (0,0)
        deviceInstanceLower: 3,
        deviceInstanceUpper: 9
      })
    )
    const ac: any = dev.addressClaim
    expect(ac.fields.deviceInstanceLower).toBe(3)
    expect(ac.fields.deviceInstanceUpper).toBe(9)
  })

  test('systemInstance = 7 is applied', () => {
    dev = new CanDevice(
      { sendPGN: () => undefined },
      makeOptions({ systemInstance: 7 })
    )
    const ac: any = dev.addressClaim
    expect(ac.fields.systemInstance).toBe(7)
  })

  test('numeric strings ("3") are coerced — admin UI form inputs deliver strings', () => {
    dev = new CanDevice(
      { sendPGN: () => undefined },
      makeOptions({ deviceInstance: '3', systemInstance: '5' })
    )
    const ac: any = dev.addressClaim
    expect(ac.fields.deviceInstanceLower).toBe(3)
    expect(ac.fields.deviceInstanceUpper).toBe(0)
    expect(ac.fields.systemInstance).toBe(5)
  })

  test('non-numeric instance values fall back to 0', () => {
    dev = new CanDevice(
      { sendPGN: () => undefined },
      makeOptions({
        deviceInstance: 'huh',
        systemInstance: null
      })
    )
    const ac: any = dev.addressClaim
    expect(ac.fields.deviceInstanceLower).toBe(0)
    expect(ac.fields.deviceInstanceUpper).toBe(0)
    expect(ac.fields.systemInstance).toBe(0)
  })

  test('out-of-range values fall back to 0 (no silent bit-mask wrap)', () => {
    // Bit-masking a 257 produces deviceInstance=1, which surprises the
    // user who set it to 257 thinking the bus would carry that exact
    // value. Drop the input on the floor instead.
    dev = new CanDevice(
      { sendPGN: () => undefined },
      makeOptions({
        deviceInstance: 257,
        deviceInstanceLower: 8, // > 0x07
        deviceInstanceUpper: 32, // > 0x1f
        systemInstance: 16 // > 0x0f
      })
    )
    const ac: any = dev.addressClaim
    expect(ac.fields.deviceInstanceLower).toBe(0)
    expect(ac.fields.deviceInstanceUpper).toBe(0)
    expect(ac.fields.systemInstance).toBe(0)
  })

  test('negative values fall back to 0', () => {
    dev = new CanDevice(
      { sendPGN: () => undefined },
      makeOptions({
        deviceInstance: -1,
        systemInstance: -5
      })
    )
    const ac: any = dev.addressClaim
    expect(ac.fields.deviceInstanceLower).toBe(0)
    expect(ac.fields.deviceInstanceUpper).toBe(0)
    expect(ac.fields.systemInstance).toBe(0)
  })
})

describe('N2kDevice unique number', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const persist = require('./persist')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { machineUniqueNumber } = require('./machineId')

  afterEach(() => {
    persist.getPersistedData.mockReset()
    persist.getPersistedData.mockImplementation(() => undefined)
    persist.savePersistedData.mockClear()
  })

  test('derives it from the machine, without storing it', () => {
    const expected = machineUniqueNumber('test')
    if (expected === undefined) {
      return // a machine without an id: covered by the random fallback
    }
    const dev = new CanDevice(
      { sendPGN: () => undefined },
      makeOptions({ uniqueNumber: undefined })
    )
    expect((dev.addressClaim as any).fields.uniqueNumber).toBe(expected)
    expect(persist.savePersistedData).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'uniqueNumber',
      expect.anything()
    )
    dev.stop()
  })

  test('keeps one stored by an earlier version', () => {
    persist.getPersistedData.mockImplementation(
      (_o: unknown, _id: string, key: string) =>
        key === 'uniqueNumber' ? 424242 : undefined
    )
    const dev = new CanDevice(
      { sendPGN: () => undefined },
      makeOptions({ uniqueNumber: undefined })
    )
    expect((dev.addressClaim as any).fields.uniqueNumber).toBe(424242)
    dev.stop()
  })
})

describe('N2kDevice address claim, as canboat runs it', () => {
  let dev: CanDevice | undefined
  let sent: any[]

  beforeEach(() => {
    jest.useFakeTimers()
    sent = []
  })

  afterEach(() => {
    if (dev) {
      dev.stop()
      dev = undefined
    }
    jest.useRealTimers()
  })

  const device = (preferredAddress: number) => {
    dev = new CanDevice(
      { sendPGN: (pgn: any) => sent.push({ ...pgn }) },
      makeOptions({
        preferredAddress,
        uniqueNumber: 12345,
        app: {
          on: () => undefined,
          removeListener: () => undefined,
          emit: () => undefined
        }
      })
    )
    return dev
  }
  const claimsSent = () => sent.filter((p) => p.pgn === 60928).map((p) => p.src)
  // A claim for `src` by another device; its NAME is ours with another
  // unique number: lower for 0, higher for 0x1fffff.
  const peerClaim = (d: CanDevice, src: number, uniqueNumber: number) => {
    const claim = JSON.parse(JSON.stringify(d.addressClaim))
    claim.fields.uniqueNumber = uniqueNumber
    claim.src = src
    claim.dst = 255
    claim.pgn = 60928
    return claim
  }

  test('asks from the null address, then claims after the scan', () => {
    const d = device(42)
    d.start()
    expect(sent[0].pgn).toBe(59904)
    expect(sent[0].src).toBe(254)
    expect(sent[0].forceSrc).toBe(true)
    jest.advanceTimersByTime(1000)
    expect(claimsSent()).toEqual([42])
    expect(d.cansend).toBe(false)
    jest.advanceTimersByTime(250)
    expect(d.cansend).toBe(true)
    expect(d.address).toBe(42)
  })

  test('loses its address to a lower NAME while the claim is pending', () => {
    const d = device(42)
    d.start()
    jest.advanceTimersByTime(1100) // claim sent, not settled
    d.n2kMessage(peerClaim(d, 42, 0))
    expect(claimsSent()).toEqual([42, 43])
    jest.advanceTimersByTime(250)
    expect(d.cansend).toBe(true)
    expect(d.address).toBe(43)
  })

  test('stops sending after losing its address until the new claim settles', () => {
    const d = device(42)
    d.start()
    jest.advanceTimersByTime(1250)
    expect(d.cansend).toBe(true)
    d.n2kMessage(peerClaim(d, 42, 0))
    expect(d.address).toBe(43)
    expect(d.cansend).toBe(false)
    jest.advanceTimersByTime(250)
    expect(d.cansend).toBe(true)
  })

  test('keeps its address against a higher NAME and claims it again', () => {
    const d = device(42)
    d.start()
    jest.advanceTimersByTime(1250)
    d.n2kMessage(peerClaim(d, 42, 0x1fffff))
    expect(claimsSent()).toEqual([42, 42])
    expect(d.cansend).toBe(true) // still sending while it re-claims
    jest.advanceTimersByTime(250)
    expect(d.address).toBe(42)
  })

  test('ignores its own claim, from any address', () => {
    const d = device(42)
    d.start()
    jest.advanceTimersByTime(1250)
    d.n2kMessage(peerClaim(d, 42, 12345))
    d.n2kMessage(peerClaim(d, 41, 12345))
    expect(claimsSent()).toEqual([42])
    expect(d.devices[41]).toBeUndefined()
  })

  test('answers a claim request while its claim is still pending', () => {
    const d = device(42)
    d.start()
    jest.advanceTimersByTime(1100)
    sent = []
    d.n2kMessage({
      pgn: 59904,
      src: 7,
      dst: 255,
      fields: { pgn: 60928 }
    } as any)
    expect(claimsSent()).toEqual([42])
  })
})
