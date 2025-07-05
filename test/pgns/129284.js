module.exports = [
  {
    expected: {
      timestamp: '2017-04-15T14:57:58.468Z',
      prio: 3,
      src: 3,
      dst: 255,
      pgn: 129284,
      description: 'Navigation Data',
      fields: {
        sid: 11,
        distanceToWaypoint: 3234,
        courseBearingReference: 'True',
        perpendicularCrossed: 'No',
        arrivalCircleEntered: 'No',
        calculationType: 'Great Circle',
        etaTime: '15:19:50',
        etaDate: '2017.04.15',
        bearingOriginToDestinationWaypoint: 2.0961,
        bearingPositionToDestinationWaypoint: 2.0961,
        destinationWaypointNumber: 2,
        destinationLatitude: 39.0554743,
        destinationLongitude: -76.4316303,
        waypointClosingVelocity: 2.46,
        originWaypointNumber: null
      }
    },
    input:
      '2017-04-15T14:57:58.468Z,3,129284,3,255,34,0b,48,ef,04,00,00,60,53,e5,20,77,43,e1,51,e1,51,ff,ff,ff,ff,02,00,00,00,77,64,47,17,71,75,71,d2,f6,00'
  }
]
