module.exports = [
  {
    expected: {
      timestamp: '2017-04-15T14:57:58.469Z',
      prio: 2,
      src: 172,
      dst: 255,
      pgn: 127237,
      description: 'Heading/Track control',
      fields: {
        rudderLimitExceeded: 'No',
        override: 'No',
        steeringMode: 'Follow-Up Device',
        turnMode: 'Rudder limit controlled',
        commandedRudderDirection: 'Move to starboard',
        commandedRudderAngle: -0.0015,
        headingReference: null,
        headingToSteerCourse: null,
        offHeadingLimit: null,
        offHeadingLimitExceeded: null,
        offTrackLimit: null,
        offTrackLimitExceeded: null,
        radiusOfTurnOrder: null,
        rateOfTurnOrder: null,
        reserved: null,
        rudderLimit: null,
        vesselHeading: null,
        track: null
      }
    },
    input:
      '2017-04-15T14:57:58.469Z,2,127237,172,255,21,3c,c2,3f,f1,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,7f,ff,7f,ff,7f,ff,ff'
  }
]
