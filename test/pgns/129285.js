module.exports = [
{
  expected: {
    prio: 6,
    pgn: 129285,
    dst: 255,
    src: 3,
    timestamp: '2017-04-15T16:16:45.897Z',
    fields: {
      nitems: 3,
      list: [
        {
          wpId: 3,
          wpName: 'ORIGIN',
          wpLatitude: 39.0525373,
          wpLongitude: -76.4183194
        },
        {
          wpId: 4,
          wpName: 'Waypoint 168',
          wpLatitude: 39.0598473,
          wpLongitude: -76.2794236
        },
        {
          wpId: 5,
          wpName: 'Waypoint 245',
          wpLatitude: 39.0190642,
          wpLongitude: -76.2520773
        }
      ],
      startRps: 3,
      databaseId: 0,
      routeId: 0,
      supplementaryRouteWpDataAvailable: 'Off',
      reserved: 0,
      routeName: 'Route',
      reserved9: null,
      navigationDirectionInRoute: null
    },
    description: 'Navigation - Route/WP Information'
  },
  input: '2017-04-15T16:16:45.897Z,6,129285,3,255,83,03,00,03,00,00,00,00,00,07,07,01,52,6f,75,74,65,ff,03,00,08,01,4f,52,49,47,49,4e,bd,f1,46,17,66,7d,73,d2,04,00,0e,01,57,61,79,70,6f,69,6e,74,20,31,36,38,49,0f,48,17,04,af,88,d2,05,00,0e,01,57,61,79,70,6f,69,6e,74,20,32,34,35,32,d6,41,17,3b,db,8c,d2'
}
,
{
  expected: {
    canId: 435750154,
    prio: 6,
    src: 10,
    dst: 255,
    pgn: 129285,
    direction: 'R',
    time: '17:29:52.266',
    fields: {
      nitems: 3,
      list: [
        {
          wpId: 1,
          wpName: 'Waypoint 717',
          wpLatitude: 39.0641674,
          wpLongitude: -76.4878892
        },
        {
          wpId: 2,
          wpName: 'Waypoint 716',
          wpLatitude: 39.0689516,
          wpLongitude: -76.4831686
        },
        {
          wpId: 3,
          wpName: 'Waypoint 715',
          wpLatitude: 39.0700745,
          wpLongitude: -76.4798802
        }
      ],
      startRps: 1,
      databaseId: 0,
      routeId: 0,
      supplementaryRouteWpDataAvailable: 'Off',
      reserved: 0,
      routeName: 'Route',
      navigationDirectionInRoute: null,
      reserved9: null
    },
    description: 'Navigation - Route/WP Information',
    timestamp: '2023-07-23T17:37:26.091Z'
  },
  format: 0,
  ignoreTimestamp: true,
  disabled: false,
  input: [
    '17:29:52.256 R 19F9050A 20 59 01 00 03 00 00 00',
    '17:29:52.257 R 19F9050A 21 00 00 07 07 01 52 6F',
    '17:29:52.258 R 19F9050A 22 75 74 65 FF 01 00 0E',
    '17:29:52.259 R 19F9050A 23 01 57 61 79 70 6F 69',
    '17:29:52.260 R 19F9050A 24 6E 74 20 37 31 37 0A',
    '17:29:52.261 R 19F9050A 25 B8 48 17 D4 DF 68 D2',
    '17:29:52.261 R 19F9050A 26 02 00 0E 01 57 61 79',
    '17:29:52.262 R 19F9050A 27 70 6F 69 6E 74 20 37',
    '17:29:52.263 R 19F9050A 28 31 36 EC 72 49 17 3A',
    '17:29:52.264 R 19F9050A 29 98 69 D2 03 00 0E 01',
    '17:29:52.264 R 19F9050A 2A 57 61 79 70 6F 69 6E',
    '17:29:52.265 R 19F9050A 2B 74 20 37 31 35 C9 9E',
    '17:29:52.266 R 19F9050A 2C 49 17 AE 18 6A D2 FF'
  ]
}
,
]
