const chai = require('chai')
chai.Should()
chai.use(require('chai-things'))
chai.use(require('chai-json-equal'))

const { FromPgn } = require('../dist/index')

describe('from pcdin data converts', function () {
  it(`from 127257 converts`, function (done) {
    var pcdin = '$PCDIN,01F119,00000000,0F,2AAF00D1067414FF*59'
    var expected = {
      pgn: 127257,
      timer: 1262304000000,
      src: 15,
      dst: 255,
      prio: 0,
      fields: {
        sid: 42,
        pitch: 0.1745,
        roll: 0.5236,
        yaw: 0.0175
      },
      description: 'Attitude'
    }

    var fromPgn = new FromPgn()

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
        delete pgn.id
        // no time in the sentence: the time it was read
        new Date(pgn.timestamp).getTime().should.be.closeTo(Date.now(), 5000)
        delete pgn.timestamp
        pgn.should.jsonEqual(expected)
        done()
      } catch (e) {
        done(e)
      }
    })

    fromPgn.parseString(pcdin)
  })

  it(`from 127257 converts with tag blocks`, function (done) {
    var pcdin =
      '\\s:serial,c:1696759212*3E\\$PCDIN,01F119,00000000,0F,2AAF00D1067414FF*59'
    var expected = {
      pgn: 127257,
      timer: 1262304000000,
      src: 15,
      dst: 255,
      prio: 0,
      fields: {
        sid: 42,
        pitch: 0.1745,
        roll: 0.5236,
        yaw: 0.0175
      },
      description: 'Attitude'
    }

    var fromPgn = new FromPgn()

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
        delete pgn.id
        // no time in the sentence: the time it was read
        new Date(pgn.timestamp).getTime().should.be.closeTo(Date.now(), 5000)
        delete pgn.timestamp
        pgn.should.jsonEqual(expected)
        done()
      } catch (e) {
        done(e)
      }
    })

    fromPgn.parseString(pcdin)
  })
})
