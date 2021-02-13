const chai = require('chai')
chai.Should()
chai.use(require('chai-things'))
chai.use(require('chai-json-equal'));

const { FromPgn, pgnToActisenseSerialFormat } = require('../index')
const EventEmitter = require('events')

describe('custom pgns', function () {

  it(`custom pgn in`, function (done) {
    
    const emitter = new EventEmitter();

    emitter.on('canboat-custom-pgn-available', () => {
      emitter.emit('canboat-custom-pgn', definition)
    })
    var fromPgn = new FromPgn({}, emitter)

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
        pgn.should.jsonEqual(expected)
        done()
      } catch ( e ) {
        done(e)
      }
    })

    fromPgn.parseString(input)
  })

  it(`custom pgn out`, function (done) {

    var actisense = pgnToActisenseSerialFormat(expected)
    actisense = actisense.slice(actisense.indexOf(','))
    actisense.should.equal(',2,127999,0,255,21,3c,c2,3f,f1,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,7f,ff,7f,ff,7f,ff,ff')
    done()
  })

  it(`custom pgn callback works`, function (done) {
    
    const emitter = new EventEmitter();

    emitter.on('canboat-custom-pgn-available', () => {
      emitter.emit('canboat-custom-pgn', definition, (pgn) => {
        try {
          //console.log(JSON.stringify(pgn))
          delete pgn.input
          pgn.should.jsonEqual(expected)
          done()
        } catch ( e ) {
          done(e)
        }
      })
    })
    var fromPgn = new FromPgn({}, emitter)

    fromPgn.on('error', (pgn, error) => {
      console.error(`Error parsing ${pgn.pgn} ${error}`)
      console.error(error.stack)
      done(error)
    })

    fromPgn.on('warning', (pgn, warning) => {
      done(new Error(`${pgn.pgn} ${warning}`))
    })

    fromPgn.parseString(input)
  })
})


const input = "2017-04-15T14:57:58.469Z,2,127999,172,255,21,3c,c2,3f,f1,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,7f,ff,7f,ff,7f,ff,ff"
var expected = {
  "timestamp":"2017-04-15T14:57:58.469Z",
  "prio":2,
  "src":172,
  "dst":255,
  "pgn":127999,
  "description":"Heading/Track control",
  "fields":{
    "Rudder Limit Exceeded":"No",
    "Override":"No",
    "Steering Mode":2,
    "Turn Mode":"Rudder Limit controlled",
    "Commanded Rudder Direction":"Move to starboard",
    "Commanded Rudder Angle":-0.0015
  }
}
const definition = {
  "PGN":127999,
  "Id":"headingTrackControl",
  "Description":"Heading/Track control",
  "Type":"Fast",
  "Complete":true,
  "Length":21,
  "RepeatingFields":0,
  "Fields":[
    {
      "Order":1,
      "Id":"rudderLimitExceeded",
      "Name":"Rudder Limit Exceeded",
      "BitLength":2,
      "BitOffset":0,
      "BitStart":0,
      "Type":"Lookup table",
      "Signed":false,
      "EnumValues":[
        {"name":"No","value":"0"},
        {"name":"Yes","value":"1"},
        {"name":"Error","value":"10"},
        {"name":"Unavailable","value":"11"}]},
    {
      "Order":2,
      "Id":"offHeadingLimitExceeded",
      "Name":"Off-Heading Limit Exceeded",
      "BitLength":2,
      "BitOffset":2,
      "BitStart":2,
      "Type":"Lookup table",
      "Signed":false,
      "EnumValues":[
        {"name":"No","value":"0"},
        {"name":"Yes","value":"1"},
        {"name":"Error","value":"10"},
        {"name":"Unavailable","value":"11"}]},
    {
      "Order":3,
      "Id":"offTrackLimitExceeded",
      "Name":"Off-Track Limit Exceeded",
      "BitLength":2,
      "BitOffset":4,
      "BitStart":4,
      "Type":"Lookup table",
      "Signed":false,
      "EnumValues":[
        {"name":"No","value":"0"},
        {"name":"Yes","value":"1"},
        {"name":"Error","value":"10"},
        {"name":"Unavailable","value":"11"}]},
    {
      "Order":4,
      "Id":"override",
      "Name":"Override",
      "BitLength":2,
      "BitOffset":6,
      "BitStart":6,
      "Type":"Lookup table",
      "Signed":false,
      "EnumValues":[
        {"name":"No","value":"0"},
        {"name":"Yes","value":"1"},
        {"name":"Error","value":"10"},
        {"name":"Unavailable","value":"11"}]},
    {
      "Order":5,
      "Id":"steeringMode",
      "Name":"Steering Mode",
      "BitLength":3,
      "BitOffset":8,
      "BitStart":0,
      "Type":"Lookup table",
      "Signed":false,
      "EnumValues":[
        {"name":"Main Steering","value":"0"},
        {"name":"Non-Follow-up Device","value":"1"},
        {"name":"Follow-up Device","value":"10"},
        {"name":"Heading Control Standalone","value":"11"},
        {"name":"Heading Control","value":"100"},
        {"name":"Track Control","value":"101"}]},
    {
      "Order":6,
      "Id":"turnMode",
      "Name":"Turn Mode",
      "BitLength":3,
      "BitOffset":11,
      "BitStart":3,
      "Type":"Lookup table",
      "Signed":false,
      "EnumValues":[
        {"name":"Rudder Limit controlled","value":"0"},
        {"name":"turn rate controlled","value":"1"},
        {"name":"radius controlled","value":"10"}]},
    {
      "Order":7,
      "Id":"headingReference",
      "Name":"Heading Reference",
      "BitLength":2,
      "BitOffset":14,
      "BitStart":6,
      "Type":"Lookup table",
      "Signed":false,
      "EnumValues":[
        {"name":"True","value":"0"},
        {"name":"Magnetic","value":"1"},
        {"name":"Error","value":"2"},
        {"name":"Null","value":"3"}]},
    {
      "Order":8,
      "Id":"reserved",
      "Name":"Reserved",
      "BitLength":5,
      "BitOffset":16,
      "BitStart":0,
      "Type":"Binary data",
      "Signed":false},
    {
      "Order":9,
      "Id":"commandedRudderDirection",
      "Name":"Commanded Rudder Direction",
      "BitLength":3,
      "BitOffset":21,
      "BitStart":5,
      "Type":"Lookup table",
      "Signed":false,
      "EnumValues":[
        {"name":"No Order","value":"0"},
        {"name":"Move to starboard","value":"1"},
        {"name":"Move to port","value":"10"}]},
    {
      "Order":10,
      "Id":"commandedRudderAngle",
      "Name":"Commanded Rudder Angle",
      "BitLength":16,
      "BitOffset":24,
      "BitStart":0,
      "Units":"rad",
      "Resolution":"0.0001",
      "Signed":true},
    {
      "Order":11,
      "Id":"headingToSteerCourse",
      "Name":"Heading-To-Steer (Course)",
      "BitLength":16,
      "BitOffset":40,
      "BitStart":0,
      "Units":"rad",
      "Resolution":"0.0001",
      "Signed":false},
    {
      "Order":12,
      "Id":"track",
      "Name":"Track",
      "BitLength":16,
      "BitOffset":56,
      "BitStart":0,
      "Units":"rad",
      "Resolution":"0.0001",
      "Signed":false},
    {
      "Order":13,
      "Id":"rudderLimit",
      "Name":"Rudder Limit",
      "BitLength":16,
      "BitOffset":72,
      "BitStart":0,
      "Units":"rad",
      "Resolution":"0.0001",
      "Signed":false},
    {
      "Order":14,
      "Id":"offHeadingLimit",
      "Name":"Off-Heading Limit",
      "BitLength":16,
      "BitOffset":88,
      "BitStart":0,
      "Units":"rad",
      "Resolution":"0.0001",
      "Signed":false},
    {
      "Order":15,
      "Id":"radiusOfTurnOrder",
      "Name":"Radius of Turn Order",
      "BitLength":16,
      "BitOffset":104,
      "BitStart":0,
      "Units":"rad",
      "Resolution":"0.0001",
      "Signed":true},
    {
      "Order":16,
      "Id":"rateOfTurnOrder",
      "Name":"Rate of Turn Order",
      "BitLength":16,
      "BitOffset":120,
      "BitStart":0,
      "Units":"rad/s",
      "Resolution":3.125e-05,
      "Signed":true},
    {
      "Order":17,
      "Id":"offTrackLimit",
      "Name":"Off-Track Limit",
      "BitLength":16,
      "BitOffset":136,
      "BitStart":0,
      "Units":"m",
      "Signed":true},
    {
      "Order":18,
      "Id":"vesselHeading",
      "Name":"Vessel Heading",
      "BitLength":16,
      "BitOffset":152,
      "BitStart":0,
      "Units":"rad",
      "Resolution":"0.0001",
      "Signed":false}]
}
