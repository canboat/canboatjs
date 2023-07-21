const chai = require('chai')
chai.Should()
chai.use(require('chai-things'))
chai.use(require('chai-json-equal'));

const { lookupEnumerationValue, lookupEnumerationName} = require('../index')

describe('enumeration lookups work', function () {
  it(`name lookup works`, function (done) {
    chai.expect(lookupEnumerationName('SHIP_TYPE', 21))
      .eq('Wing In Ground (hazard cat X)')
    done()
  })

  it(`value lookup works`, function (done) {
    chai.expect(lookupEnumerationValue('SHIP_TYPE',
                                       'Wing In Ground (hazard cat X)'))
      .eq(21)
    done()
  })
})
