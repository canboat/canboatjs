const chai = require('chai')
chai.Should()
chai.use(require('chai-things'))
chai.use(require('chai-json-equal'))

const {
  lookupEnumerationValue,
  lookupEnumerationName
} = require('../dist/index')

describe('enumeration lookups work', function () {
  it(`name lookup works`, function (done) {
    chai
      .expect(lookupEnumerationName('SHIP_TYPE', 21))
      .eq('Wing In Ground (hazard cat X)')
    done()
  })

  it(`value lookup works`, function (done) {
    chai
      .expect(
        lookupEnumerationValue('SHIP_TYPE', 'Wing In Ground (hazard cat X)')
      )
      .eq(21)
    done()
  })
})

describe('an unnamed lookup value', () => {
  const { FromPgn } = require('../dist/index')
  const { toPgn } = require('../dist/toPgn')
  const line =
    '2026-07-10T06:28:09.178Z,4,129038,41,255,28,01,48,93,47,0f,55,87,f7,51,53,dd,14,13,1d,4c,9c,16,02,aa,02,0a,5e,99,01,00,c0,f8,ff'

  it('is its number, as canboat gives it (an AIS time stamp, #565)', () => {
    const pgn = new FromPgn({ useCamel: true }).parseString(line)
    pgn.fields.timeStamp.should.equal(7)
  })

  it('is still written from the string form canboatjs gave before', () => {
    const pgn = new FromPgn({ useCamel: true }).parseString(line)
    const asNumber = Buffer.from(toPgn(pgn)).toString('hex')
    pgn.fields.timeStamp = '7'
    Buffer.from(toPgn(pgn)).toString('hex').should.equal(asNumber)
  })
})
