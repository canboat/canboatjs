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
  test('defaults: deviceInstanceLower=0, deviceInstanceUpper=0, systemInstance=0', () => {
    const dev = new CanDevice({ sendPGN: () => undefined }, makeOptions())
    const ac: any = dev.addressClaim
    expect(ac.fields.deviceInstanceLower).toBe(0)
    expect(ac.fields.deviceInstanceUpper).toBe(0)
    expect(ac.fields.systemInstance).toBe(0)
    dev.stop()
  })

  test('combined deviceInstance = 5 → lower=5, upper=0', () => {
    const dev = new CanDevice(
      { sendPGN: () => undefined },
      makeOptions({ deviceInstance: 5 })
    )
    const ac: any = dev.addressClaim
    expect(ac.fields.deviceInstanceLower).toBe(5)
    expect(ac.fields.deviceInstanceUpper).toBe(0)
    dev.stop()
  })

  test('combined deviceInstance = 12 → lower=4, upper=1', () => {
    // 12 = (1<<3) | 4
    const dev = new CanDevice(
      { sendPGN: () => undefined },
      makeOptions({ deviceInstance: 12 })
    )
    const ac: any = dev.addressClaim
    expect(ac.fields.deviceInstanceLower).toBe(4)
    expect(ac.fields.deviceInstanceUpper).toBe(1)
    dev.stop()
  })

  test('combined deviceInstance = 255 → lower=7, upper=31', () => {
    const dev = new CanDevice(
      { sendPGN: () => undefined },
      makeOptions({ deviceInstance: 255 })
    )
    const ac: any = dev.addressClaim
    expect(ac.fields.deviceInstanceLower).toBe(7)
    expect(ac.fields.deviceInstanceUpper).toBe(31)
    dev.stop()
  })

  test('explicit deviceInstanceLower / deviceInstanceUpper override combined', () => {
    const dev = new CanDevice(
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
    dev.stop()
  })

  test('systemInstance = 7 is applied', () => {
    const dev = new CanDevice(
      { sendPGN: () => undefined },
      makeOptions({ systemInstance: 7 })
    )
    const ac: any = dev.addressClaim
    expect(ac.fields.systemInstance).toBe(7)
    dev.stop()
  })

  test('non-numeric instance values fall back to 0', () => {
    const dev = new CanDevice(
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
    dev.stop()
  })
})
