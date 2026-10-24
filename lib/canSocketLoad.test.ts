// CanChannel without its native addon: the error says why, and on Linux how
// to build it (#533).

jest.mock('node-gyp-build', () => () => {
  throw new Error(
    'No native build was found for platform=linux arch=arm64\n    loaded from: /x\n'
  )
})

import { CanChannel } from './canSocket'

describe('CanChannel without the native addon', () => {
  const platform = process.platform
  const setPlatform = (value: string) =>
    Object.defineProperty(process, 'platform', { value })
  afterEach(() => setPlatform(platform))

  test('on Linux, says the addon failed to load and how to build it', () => {
    setPlatform('linux')
    expect(() => new CanChannel('can0')).toThrow(
      /^Failed to load native canSocket module: No native build was found for platform=linux arch=arm64\. To build it, run "npx node-gyp rebuild" in .+, then restart$/
    )
  })

  test('elsewhere, says SocketCAN is Linux only', () => {
    setPlatform('darwin')
    expect(() => new CanChannel('can0')).toThrow(
      'canbus connections need SocketCAN, which is Linux only (this is darwin)'
    )
  })
})
