const chai = require('chai')
chai.Should()
chai.use(require('chai-things'))
chai.use(require('chai-json-equal'));

const { FromPgn } = require('../index')

describe('from pcdin data converts', function () {

  it(`from 127257 converts`, function (done) {
    var pcdin = '$PCDIN,01F119,00000000,0F,2AAF00D1067414FF*59'
    var expected = {
      "pgn":127257,
      "timestamp": "2010-01-01T00:00:00.000Z",
      "timer": 1262304000000,
      "src":15,
      "dst":255,
      "prio":0,
      "fields":{
        "SID": 42,
        "Pitch": 0.1745,
        "Roll": 0.5236,
        "Yaw": 0.0175
      },
      "description":"Attitude"
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

        pgn.should.jsonEqual(expected)
        done()
      } catch ( e ) {
        done(e)
      }
    })

    fromPgn.parseString(pcdin)
  })
})
