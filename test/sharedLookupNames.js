const chai = require('chai')
chai.Should()

const { FromPgn } = require('../dist/index')
const { getEnumeration, updateLookup } = require('@canboat/ts-pgns')

// A primary-key field whose lookup gives its name to more than one code is
// read as the code (#557). updateLookup changes a lookup in place, keeping
// its object, so that is worked out again after it.
describe('a shared lookup name in a primary-key field', () => {
  const ENUM = 'MAGNETIC_VARIATION'
  let original

  before(() => {
    original = getEnumeration(ENUM).EnumValues
  })
  after(() => {
    updateLookup({ ...getEnumeration(ENUM), EnumValues: original })
  })

  // 127258 Magnetic Variation, its source (part of the primary key) 1.
  const source = () =>
    new FromPgn({ useCamel: true }).parseString(
      '2026-01-01T00:00:00.000Z,7,127258,1,255,8,00,f1,ff,ff,ff,ff,ff,ff'
    ).fields.source

  it('is read as the code once updateLookup makes it shared', () => {
    source().should.equal('Automatic Chart')
    updateLookup({
      ...getEnumeration(ENUM),
      EnumValues: original.map((entry) =>
        entry.Value === 2 ? { ...entry, Name: 'Automatic Chart' } : entry
      )
    })
    source().should.equal(1)
  })

  it('is read as the name again once it is its own', () => {
    updateLookup({ ...getEnumeration(ENUM), EnumValues: original })
    source().should.equal('Automatic Chart')
  })
})
