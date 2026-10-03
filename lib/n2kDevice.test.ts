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

function analyzerAddressClaim(dev: CanDevice, uniqueNumber?: number) {
  const echo = JSON.parse(JSON.stringify(dev.addressClaim))
  echo.src = dev.address
  echo.dst = 255
  echo.pgn = 60928
  if (uniqueNumber !== undefined) {
    echo.fields.uniqueNumber = uniqueNumber
  }
  return echo
}

describe('N2kDevice ISO address claim echo', () => {
  let dev: CanDevice | undefined

  afterEach(() => {
    jest.useRealTimers()
    if (dev) {
      dev.stop()
      dev = undefined
    }
  })

  test('own 60928 while cansend is false does not populate devices[preferred] or bump address', () => {
    jest.useFakeTimers()
    const preferredAddress = 37
    dev = new CanDevice(
      { sendPGN: () => undefined },
      makeOptions({
        preferredAddress,
        uniqueNumber: 1060571,
        addressClaimDetectionTime: 5000
      })
    )

    expect(dev.cansend).toBe(false)
    dev.n2kMessage(analyzerAddressClaim(dev))

    expect(dev.devices[preferredAddress]).toBeUndefined()

    dev.start()
    jest.advanceTimersByTime(1000)

    expect(dev.address).toBe(preferredAddress)
    expect(dev.devices[preferredAddress]).toBeUndefined()
  })

  test('own 60928 from another address is not registered as a peer', () => {
    jest.useFakeTimers()
    dev = new CanDevice(
      { sendPGN: () => undefined },
      makeOptions({
        preferredAddress: 37,
        uniqueNumber: 1060571,
        addressClaimDetectionTime: 5000
      })
    )

    // Our claim from an address we held before, coming back late.
    const echo = analyzerAddressClaim(dev)
    echo.src = 36
    dev.n2kMessage(echo)

    expect(dev.devices[36]).toBeUndefined()
  })

  test('peer 60928 at the preferred address still forces increaseOwnAddress', () => {
    jest.useFakeTimers()
    const preferredAddress = 37
    dev = new CanDevice(
      { sendPGN: () => undefined },
      makeOptions({
        preferredAddress,
        uniqueNumber: 1060571,
        addressClaimDetectionTime: 5000
      })
    )

    dev.n2kMessage(analyzerAddressClaim(dev, 1))

    expect(dev.devices[preferredAddress]).toBeDefined()

    dev.start()
    jest.advanceTimersByTime(1000)

    expect(dev.address).not.toBe(preferredAddress)
  })
})
