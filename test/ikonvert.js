debugger

const chai = require('chai')
chai.Should()
chai.use(require('chai-things'))
chai.use(require('chai-json-equal'));

const { FromPgn, pgnToiKonvertSerialFormat } = require('../index')

const pgns = [
  {
    pdgy: '!PDGY,126992,3,2,255,0.563,d2009e45b3b8821d',
    expected: {
      "pgn":126992,
      "src":2,
      "dst":255,
      "prio":3,
      "timer": 0.563,
      "fields":{
        "Date": "2141.11.12",
        "Reserved1": "6",
        "SID": 119,
        "Source": 13,
        "Time": "55:11:40.08140"
      },
      "description":"System Time"
    }
  },
  {
    pdgy: '!PDGY,129029,3,2,255,483.236,UZ9FfR+bI/////////9//////////3//////////fwD8AIgTiBMAAAAAAQAAAAA',
    expected:
    {
      "pgn":129029,
      "prio":3,
      "src":2,
      "dst":255,
      "timer": 483.236,
      "fields":{
        "SID":81,
        "Date":"2018.10.19",
        "Time":"16:35:36.87010",
        "GNSS type":"GPS",
        "Method":"no GNSS",
        "Integrity":"No integrity checking",
        "Number of SVs":0,
        "HDOP":50,
        "PDOP":50,
        "Geoidal Separation":0,
        "Reference Stations":1,
        "list":[
          {
            "Reference Station Type":"GPS",
            "Reference Station ID":0,
            "Age of DGNSS Corrections":0
          }
        ]
      },
      "description":"GNSS Position Data"
    }
  }
]

const output = '!PDGY,126992,255,d2009e45b3Y='

describe('to ikconnect data converts', function () {
  it(`to 126992 converts`, function (done) {
    let msg = pgnToiKonvertSerialFormat(pgns[0].expected)
    msg.should.equal(output)
    done()
  })
})

describe('from ikconnect data converts', function () {
  pgns.forEach(info => {
    it(`from ${info.expected.pgn} converts`, function (done) {

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
          info.expected.timestamp = pgn.timestamp
          pgn.should.jsonEqual(info.expected)
          done()
        } catch ( e ) {
          done(e)
        }
      })

      fromPgn.parseString(info.pdgy)
    })
  })
  it('errors out on invalid string', (done) => {
    const fromPgn = new FromPgn()
    fromPgn.on('error', (pgn, err) => {
      pgn.input.should.equal('!PDSOME,1234,invalid,3,2,255,fwD8AIAA')
      err.message.should.equal('Parser not found for input. - !PDSOME,1234,invalid,3,2,255,fwD8AIAA')
      done()
    })
    fromPgn.on('pgn', (pgn) => {
      done(new Error('should not emit pgn'))
    })
    fromPgn.parseString('!PDSOME,1234,invalid,3,2,255,fwD8AIAA')
  })
  it('errors out on missing data', (done) => {
    const fromPgn = new FromPgn()
    fromPgn.on('error', (pgn, err) => {
      pgn.input.should.equal('!PDGY,126992,3,2,255,0.563')
      err.message.should.equal('Invalid parts. - !PDGY,126992,3,2,255,0.563')
      done()
    })
    fromPgn.on('pgn', (pgn) => {
      done(new Error('should not emit pgn'))
    })
    fromPgn.parseString('!PDGY,126992,3,2,255,0.563')
  })
})
