const { expect } = require('chai')
const { FromPgn, toPgn } = require('../dist/index')

describe('J1939 Excess-K power fields', function () {
  it('omits no-data power from the issue #468 frame', function () {
    const p = new FromPgn({ useCamel: true })
    const result = p.parseString(
      '2026-09-24T00:00:00.000Z,3,65029,132,255,8,ff,ff,ff,ff,e8,97,35,77'
    )
    expect(result.fields).to.deep.equal({ apparentPower: 1000 })
  })

  for (const [raw, expected] of [
    [0, -2000000000],
    [1999999500, -500],
    [2000001000, 1000],
    [0x7fffffff, 147483647],
    [0x80000000, 147483648],
    [0xfffffffc, 2294967292]
  ]) {
    it(`decodes raw ${raw} as ${expected} W`, function () {
      const bytes = Buffer.alloc(4)
      bytes.writeUInt32LE(raw)
      const data = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
      const p = new FromPgn({ useCamel: true })
      const result = p.parseString(
        `2026-09-24T00:00:00.000Z,3,65029,132,255,8,${data.join(',')},e8,97,35,77`
      )
      expect(result.fields).to.deep.equal({
        realPower: expected,
        apparentPower: 1000
      })
    })
  }

  for (const raw of [0xfffffffd, 0xfffffffe, 0xffffffff]) {
    for (const returnNulls of [false, true]) {
      it(`rejects reserved raw ${raw} with returnNulls=${returnNulls}`, function () {
        const bytes = Buffer.alloc(4)
        bytes.writeUInt32LE(raw)
        const data = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
        const p = new FromPgn({ useCamel: true, returnNulls })
        const result = p.parseString(
          `2026-09-24T00:00:00.000Z,3,65029,132,255,8,${data.join(',')},e8,97,35,77`
        )
        expect(result.fields).to.deep.equal(
          returnNulls
            ? { realPower: null, apparentPower: 1000 }
            : { apparentPower: 1000 }
        )
      })
    }
  }

  for (const fields of [
    { apparentPower: 1000 },
    { realPower: null, apparentPower: 1000 }
  ]) {
    it(`encodes ${fields.realPower === null ? 'null' : 'omitted'} power as unsigned no-data`, function () {
      expect(toPgn({ pgn: 65029, fields }).toString('hex')).to.equal(
        'ffffffffe8973577'
      )
    })
  }

  it('preserves the signed no-data marker for fields without an offset', function () {
    const input =
      '2026-09-24T00:00:00.000Z,3,127251,132,255,8,00,ff,ff,ff,7f,ff,ff,ff'
    const p = new FromPgn({ useCamel: true, returnNulls: true })
    expect(p.parseString(input).fields.rate).to.equal(null)
    expect(
      toPgn({ pgn: 127251, fields: { sid: 0, rate: null } }).toString('hex')
    ).to.equal('00ffffff7fffffff')
  })
})
