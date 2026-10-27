const chai = require('chai')
chai.Should()

const { FromPgn } = require('../dist/index')
const { toPgn } = require('../dist/toPgn')

// A field with a Match value is named by its lookup, as canboat names it
// (canboat#1097), and by the field's description only when the lookup has
// no name for it. The frames are canboat's analyzer/tests/
// pgn-matched-lookup-name.in.
const SUZUKI =
  '2026-10-23T00:00:00.000Z,6,130830,0,255,12,4a,9a,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff'
const XANTREX =
  '2026-10-23T00:00:00.000Z,6,130900,0,255,20,a8,98,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,7f,ff,ff,ff,7f,7f'
const FUSION_SIRIUSXM =
  '2026-10-23T00:00:00.000Z,7,130820,0,255,12,a3,99,29,80,01,02,ff,ff,ff,ff,ff,ff'

function decode(line) {
  return new FromPgn({ useCamel: true }).parseString(line)
}

describe('a field with a Match value', function () {
  it('is named by its lookup, as canboat names it', function () {
    decode(SUZUKI).fields.manufacturerCode.should.equal('Suzuki Motor')
    decode(XANTREX).fields.manufacturerCode.should.equal('Xantrex Technology')
    decode(FUSION_SIRIUSXM).fields.messageId.should.equal('SiriusXM Signal')
  })

  it('is encoded from its lookup name, its description or its value', function () {
    const bytes = (buffer) => Buffer.from(buffer).subarray(0, 2).toString('hex')
    for (const manufacturerCode of [
      'Suzuki Motor',
      'Suzuki Motor Corporation',
      586
    ]) {
      bytes(
        toPgn({
          pgn: 130830,
          fields: { manufacturerCode, industryCode: 'Marine Industry' }
        })
      ).should.equal('4a9a')
    }
  })

  it('encodes a decoded message back to its bytes', function () {
    // The original pads the 6 data bytes to 12 with 0xff.
    Buffer.from(toPgn(decode(FUSION_SIRIUSXM)))
      .toString('hex')
      .should.equal('a39929800102')
  })
})
