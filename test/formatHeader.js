const chai = require('chai')
chai.Should()

const { FromPgn } = require('../dist/index')

// canboat's captures say whether their lines are frames or whole messages
// with a `# format=` header (canboat#573). In a FAST capture a whole
// message of 8 bytes or less of a fast-packet PGN must not be taken for
// one of its frames (#569).
const decode = (lines) => {
  const parser = new FromPgn({ useCamel: true })
  return lines.map((line) => parser.parseString(line)).filter(Boolean)
}

describe('a # format= header', function () {
  const short = [
    '2026-09-19T02:53:17.363Z,7,130820,51,255,6,a3,99,5c,80,00,00',
    '2026-08-07T23:44:27.505Z,6,130828,1,255,8,32,99,01,13,dc,81,00,00',
    '2026-06-25T13:14:20.209Z,3,130824,38,255,2,7d,99'
  ]

  it('makes short lines of fast-packet PGNs whole messages in a FAST capture', function () {
    decode(['# format=FAST', ...short])
      .map((pgn) => pgn.description)
      .should.deep.equal([
        'Fusion: External Amp Gain',
        'Sleipner: Device Status (Fast)',
        'B&G: key-value data'
      ])
  })

  it('leaves them frames without one', function () {
    decode(short).should.have.length(0)
  })

  it('leaves them frames in a frame format', function () {
    decode(['# format=PLAIN', ...short]).should.have.length(0)
  })

  it('still reads frames that follow a frame-format header', function () {
    decode([
      '# format=PLAIN',
      '2020-08-22T13:52:36.953Z,7,130824,16,255,8,80,21,7d,99,7c,11,02,7d',
      '2020-08-22T13:52:36.953Z,7,130824,16,255,8,81,21,ff,7f,7e,21,ff,7f',
      '2020-08-22T13:52:36.953Z,7,130824,16,255,8,82,7f,21,ff,7f,80,21,ff',
      '2020-08-22T13:52:36.953Z,7,130824,16,255,8,83,ff,81,21,ff,7f,82,21',
      '2020-08-22T13:52:36.953Z,7,130824,16,255,8,84,d3,fe,83,21,3d,00,ff'
    ])
      .map((pgn) => pgn.description)
      .should.deep.equal(['B&G: key-value data'])
  })
})
