const chai = require('chai')
chai.Should()
chai.use(require('chai-things'))
chai.use(require('chai-json-equal'))

const { FromPgn } = require('../dist/index')

describe('from mxpgn data converts', function () {
  // This capture is in MXPGN's last-byte-first order, which the
  // littleEndianMXPGN option reads; the test after the next one has the same
  // position first-byte-first, read without it. Paired the other way round,
  // both decoded to an impossible latitude of -99.76.
  it(`from 129025 converts`, function (done) {
    var mxpgn = '$MXPGN,01F801,2801,C1308AC40C5DE343*19'
    var expected = {
      pgn: 129025,
      src: 1,
      dst: 255,
      prio: 2,
      fields: {
        Latitude: 20.7479619,
        Longitude: -105.3783356
      },
      description: 'Position, Rapid Update'
    }

    var fromPgn = new FromPgn({ littleEndianMXPGN: true, useCamel: false })

    fromPgn.on('error', (pgn, error) => {
      console.error(`Error parsing ${pgn.pgn} ${error}`)
      console.error(error.stack)
      done(error)
    })

    fromPgn.on('warning', (pgn, warning) => {
      done(new Error(`${pgn.pgn} ${warning}`))
    })

    fromPgn.on('pgn', (pgn) => {
      try {
        //console.log(JSON.stringify(pgn))
        delete pgn.input
        delete pgn.timestamp
        delete pgn.id
        pgn.should.jsonEqual(expected)
        done()
      } catch (e) {
        done(e)
      }
    })

    fromPgn.parseString(mxpgn)
  })

  it(`from 129025 converts with tags`, function (done) {
    var mxpgn =
      '\\s:serial,c:1696759212*3E\\$MXPGN,01F801,2801,C1308AC40C5DE343*19'
    var expected = {
      pgn: 129025,
      src: 1,
      dst: 255,
      prio: 2,
      fields: {
        Latitude: 20.7479619,
        Longitude: -105.3783356
      },
      description: 'Position, Rapid Update'
    }

    var fromPgn = new FromPgn({ littleEndianMXPGN: true, useCamel: false })

    fromPgn.on('error', (pgn, error) => {
      console.error(`Error parsing ${pgn.pgn} ${error}`)
      console.error(error.stack)
      done(error)
    })

    fromPgn.on('warning', (pgn, warning) => {
      done(new Error(`${pgn.pgn} ${warning}`))
    })

    fromPgn.on('pgn', (pgn) => {
      try {
        //console.log(JSON.stringify(pgn))
        delete pgn.input
        delete pgn.timestamp
        delete pgn.id
        pgn.should.jsonEqual(expected)
        done()
      } catch (e) {
        done(e)
      }
    })

    fromPgn.parseString(mxpgn)
  })

  it(`from little endian 129025 converts`, function (done) {
    var mxpgn = '$MXPGN,01F801,2801,43E35D0CC48A30C1'
    var expected = {
      pgn: 129025,
      src: 1,
      dst: 255,
      prio: 2,
      fields: {
        Latitude: 20.7479619,
        Longitude: -105.3783356
      },
      description: 'Position, Rapid Update'
    }

    var fromPgn = new FromPgn({ useCamel: false })

    fromPgn.on('error', (pgn, error) => {
      console.error(`Error parsing ${pgn.pgn} ${error}`)
      console.error(error.stack)
      done(error)
    })

    fromPgn.on('warning', (pgn, warning) => {
      done(new Error(`${pgn.pgn} ${warning}`))
    })

    fromPgn.on('pgn', (pgn) => {
      try {
        //console.log(JSON.stringify(pgn))
        delete pgn.input
        delete pgn.timestamp
        delete pgn.id
        pgn.should.jsonEqual(expected)
        done()
      } catch (e) {
        done(e)
      }
    })

    fromPgn.parseString(mxpgn)
  })
})
