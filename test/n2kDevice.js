const chai = require('chai')
chai.Should()

const { N2kDevice } = require('../dist/n2kDevice')
const { toPgn, FromPgn } = require('../dist/index')

describe('N2kDevice', () => {
  it('announces NMEA 2000 version 2.100 in its product information', () => {
    // The field counts in 0.001: 1300 overflowed to 0xd620, which other
    // devices read as version 54.816 (signalk-server#3002).
    const device = new N2kDevice({ uniqueNumber: 1 }, 'test')
    const data = Buffer.from(toPgn(device.productInfo))
    data.subarray(0, 2).toString('hex').should.equal('3408')
    const decoded = new FromPgn().parseString(
      `2026-10-03T00:00:00.000Z,6,126996,1,255,${data.length},` +
        [...data].map((b) => b.toString(16).padStart(2, '0')).join(',')
    )
    decoded.fields.nmea2000Version.should.equal(2.1)
  })
})
