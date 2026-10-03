import { fnv1a64, uniqueNumberFor } from './machineId'

describe('fnv1a64', () => {
  // The published FNV-1a 64 test vectors: canboat's fnv1a_64 gives these.
  test('matches the reference vectors', () => {
    expect(fnv1a64('')).toBe(0xcbf29ce484222325n)
    expect(fnv1a64('a')).toBe(0xaf63dc4c8601ec8cn)
    expect(fnv1a64('foobar')).toBe(0x85944171f73967e8n)
  })
})

describe('uniqueNumberFor', () => {
  const machine = '4c4c4544003210508051b2c04f4a3132'

  test('is the low 21 bits of the salted hash, and stable', () => {
    const n = uniqueNumberFor(machine)!
    expect(n).toBe(Number(fnv1a64(`canboatjs|${machine}`) & 0x1fffffn))
    expect(uniqueNumberFor(machine)).toBe(n)
    expect(n).toBeGreaterThanOrEqual(0)
    expect(n).toBeLessThanOrEqual(0x1fffff)
  })

  test('differs from canboat on the same machine', () => {
    const canboat = Number(fnv1a64(`canboat|${machine}`) & 0x1fffffn)
    expect(uniqueNumberFor(machine)).not.toBe(canboat)
  })

  test('tells apart connections on one machine, and machines', () => {
    const a = uniqueNumberFor(machine, 'can0')
    expect(a).not.toBe(uniqueNumberFor(machine, 'can1'))
    expect(a).not.toBe(uniqueNumberFor('another-machine', 'can0'))
  })

  test('never gives the all-ones unique number', () => {
    // '1078313' hashes to 21 one bits: the unset value analyzers hide.
    expect(fnv1a64('canboatjs|1078313') & 0x1fffffn).toBe(0x1fffffn)
    expect(uniqueNumberFor('1078313')).toBe(0x1ffffe)
  })

  test('is undefined when the machine cannot be identified', () => {
    expect(uniqueNumberFor(undefined, 'can0')).toBeUndefined()
  })
})
