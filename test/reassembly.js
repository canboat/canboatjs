const chai = require('chai')
chai.Should()
const fs = require('fs')
const path = require('path')

const { FromPgn } = require('../dist/index')

// The fixtures are canboat's own analyzer/tests inputs; canboatjs must put
// the same frames together into the same messages as canboat does
// (crates/canboat/src/engine/reassembly.rs).
function decode(file) {
  const parser = new FromPgn({ useCamel: true, returnNonMatches: true })
  parser.on('error', () => {})
  parser.on('warning', () => {})
  const out = []
  const lines = fs
    .readFileSync(path.join(__dirname, 'data', 'reassembly', file), 'utf8')
    .split('\n')
  for (const line of lines) {
    if (line.length === 0 || line.startsWith('#')) {
      continue
    }
    const pgn = parser.parseString(line)
    if (pgn) {
      out.push(pgn)
    }
  }
  return out
}

describe('fast-packet and ISO TP reassembly, as canboat', function () {
  it('recombines interleaved and out-of-order fast-packet frames', function () {
    decode('recombine-frames.in')
      .map((m) => [m.pgn, m.src])
      .should.deep.equal([
        [130311, 35],
        [129029, 0],
        [129029, 0],
        [126720, 0],
        [129029, 0],
        [129029, 0],
        [130823, 27],
        [129029, 0]
      ])
  })

  it('reassembles an ISO TP BAM transfer into the PGN it carries', function () {
    const out = decode('iso-tp-test.in')
    out.map((m) => [m.pgn, m.src]).should.deep.equal([[129540, 23]])
    out[0].fields.satsInView.should.equal(18)
    out[0].fields.list.length.should.equal(18)
  })

  it('reassembles a long ISO TP transfer', function () {
    const out = decode('iso-tp-large-payload-test.in')
    out.map((m) => [m.pgn, m.src]).should.deep.equal([[129540, 23]])
    out[0].fields.list.length.should.equal(out[0].fields.satsInView)
  })

  it('reassembles an ISO TP RTS transfer', function () {
    decode('j1939-iso-tp.plain')
      .map((m) => [m.pgn, m.src])
      .should.deep.equal([[130885, 33]])
  })
})
