const chai = require('chai')
chai.Should()
chai.use(require('chai-things'))
chai.use(require('chai-json-equal'))

const { FromPgn, pgnToActisenseSerialFormat } = require('../dist/index')
const PropertyValues = require('@signalk/server-api').PropertyValues

const definitions = {
  LookupEnumerations: [
    {
      Name: 'MY_YES_NO',
      MaxValue: 11,
      EnumValues: [
        { Name: 'No', Value: 0 },
        { Name: 'Yes', Value: 1 },
        { Name: 'Error', Value: 10 },
        { Name: 'Unavailable', Value: 11 }
      ]
    }
  ],
  PGNs: [
    {
      PGN: 127999,
      Id: 'myHeadingTrackControl',
      Description: 'Heading/Track control',
      Type: 'Fast',
      Complete: true,
      Length: 21,
      RepeatingFields: 0,
      Fields: [
        {
          Order: 1,
          Id: 'rudderLimitExceeded',
          Name: 'Rudder Limit Exceeded',
          BitLength: 2,
          BitOffset: 0,
          BitStart: 0,
          FieldType: 'LOOKUP',
          Signed: false,
          LookupEnumeration: 'MY_YES_NO'
        },
        {
          Order: 2,
          Id: 'offHeadingLimitExceeded',
          Name: 'Off-Heading Limit Exceeded',
          BitLength: 2,
          BitOffset: 2,
          BitStart: 2,
          FieldType: 'LOOKUP',
          Signed: false,
          LookupEnumeration: 'MY_YES_NO'
        },
        {
          Order: 3,
          Id: 'offTrackLimitExceeded',
          Name: 'Off-Track Limit Exceeded',
          BitLength: 2,
          BitOffset: 4,
          BitStart: 4,
          FieldType: 'LOOKUP',
          Signed: false,
          LookupEnumeration: 'MY_YES_NO'
        },
        {
          Order: 4,
          Id: 'override',
          Name: 'Override',
          BitLength: 2,
          BitOffset: 6,
          BitStart: 6,
          FieldType: 'LOOKUP',
          Signed: false,
          LookupEnumeration: 'MY_YES_NO'
        },
        {
          Order: 5,
          Id: 'steeringMode',
          Name: 'Steering Mode',
          BitLength: 3,
          BitOffset: 8,
          BitStart: 0,
          Signed: false
        },
        {
          Order: 6,
          Id: 'turnMode',
          Name: 'Turn Mode',
          BitLength: 3,
          BitOffset: 11,
          BitStart: 3,
          Signed: false
        },
        {
          Order: 7,
          Id: 'headingReference',
          Name: 'Heading Reference',
          BitLength: 2,
          BitOffset: 14,
          BitStart: 6,
          Signed: false
        },
        {
          Order: 8,
          Id: 'reserved',
          Name: 'Reserved',
          BitLength: 5,
          BitOffset: 16,
          BitStart: 0,
          FieldType: 'Binary data',
          Signed: false
        },
        {
          Order: 9,
          Id: 'commandedRudderDirection',
          Name: 'Commanded Rudder Direction',
          BitLength: 3,
          BitOffset: 21,
          BitStart: 5,
          Signed: false
        },
        {
          Order: 10,
          Id: 'commandedRudderAngle',
          Name: 'Commanded Rudder Angle',
          BitLength: 16,
          BitOffset: 24,
          BitStart: 0,
          Units: 'rad',
          Resolution: '0.0001',
          Signed: true
        },
        {
          Order: 11,
          Id: 'headingToSteerCourse',
          Name: 'Heading-To-Steer (Course)',
          BitLength: 16,
          BitOffset: 40,
          BitStart: 0,
          Units: 'rad',
          Resolution: '0.0001',
          Signed: false
        },
        {
          Order: 12,
          Id: 'track',
          Name: 'Track',
          BitLength: 16,
          BitOffset: 56,
          BitStart: 0,
          Units: 'rad',
          Resolution: '0.0001',
          Signed: false
        },
        {
          Order: 13,
          Id: 'rudderLimit',
          Name: 'Rudder Limit',
          BitLength: 16,
          BitOffset: 72,
          BitStart: 0,
          Units: 'rad',
          Resolution: '0.0001',
          Signed: false
        },
        {
          Order: 14,
          Id: 'offHeadingLimit',
          Name: 'Off-Heading Limit',
          BitLength: 16,
          BitOffset: 88,
          BitStart: 0,
          Units: 'rad',
          Resolution: '0.0001',
          Signed: false
        },
        {
          Order: 15,
          Id: 'radiusOfTurnOrder',
          Name: 'Radius of Turn Order',
          BitLength: 16,
          BitOffset: 104,
          BitStart: 0,
          Units: 'rad',
          Resolution: '0.0001',
          Signed: true
        },
        {
          Order: 16,
          Id: 'rateOfTurnOrder',
          Name: 'Rate of Turn Order',
          BitLength: 16,
          BitOffset: 120,
          BitStart: 0,
          Units: 'rad/s',
          Resolution: 3.125e-5,
          Signed: true
        },
        {
          Order: 17,
          Id: 'offTrackLimit',
          Name: 'Off-Track Limit',
          BitLength: 16,
          BitOffset: 136,
          BitStart: 0,
          Units: 'm',
          Signed: true
        },
        {
          Order: 18,
          Id: 'vesselHeading',
          Name: 'Vessel Heading',
          BitLength: 16,
          BitOffset: 152,
          BitStart: 0,
          Units: 'rad',
          Resolution: '0.0001',
          Signed: false
        }
      ]
    }
  ]
}

describe.skip('custom pgns', function () {
  const propertyValues = new PropertyValues()

  propertyValues.emitPropertyValue({
    timestamp: Date.now(),
    setter: 'customPgns',
    name: 'canboat-custom-pgns',
    value: definitions
  })

  var fromPgn = new FromPgn({
    useCamel: false,
    onPropertyValues: (name, cb) => {
      propertyValues.onPropertyValues(name, cb)
    }
  })

  it(`custom pgn in`, function (done) {
    try {
      let pgn = fromPgn.parseString(input)
      delete pgn.input
      pgn.should.jsonEqual(expected)
      done()
    } catch (e) {
      done(e)
    }
  })

  it(`custom pgn out`, function (done) {
    try {
      var actisense = pgnToActisenseSerialFormat(expected)
      actisense = actisense.slice(actisense.indexOf(','))
      actisense.should.equal(
        ',2,127999,172,255,21,3c,c2,3f,f1,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,7f,ff,7f,ff,7f,ff,ff'
      )
      done()
    } catch (err) {
      done(err)
    }
  })

  it(`custom pgn callback works`, function (done) {
    definitions.callback = (pgn) => {
      try {
        delete pgn.input
        pgn.should.jsonEqual(expected)
        done()
      } catch (e) {
        done(e)
      }
    }

    fromPgn.parseString(input)
  })
})

const input =
  '2017-04-15T14:57:58.469Z,2,127999,172,255,21,3c,c2,3f,f1,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,7f,ff,7f,ff,7f,ff,ff'
var expected = {
  timestamp: '2017-04-15T14:57:58.469Z',
  prio: 2,
  src: 172,
  dst: 255,
  pgn: 127999,
  description: 'Heading/Track control',
  fields: {
    'Rudder Limit Exceeded': 'No',
    Override: 'No',
    'Steering Mode': 2,
    'Turn Mode': 0,
    'Commanded Rudder Direction': 1,
    'Commanded Rudder Angle': -0.0015
  }
}
