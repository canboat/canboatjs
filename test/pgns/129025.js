module.exports = [
  {
    "expected": {"timestamp":"2017-04-15T14:57:58.468Z","prio":2,"src":3,"dst":255,"pgn":129025,"description":"Position, Rapid Update","fields":{"Latitude":39.0700930,"Longitude":-76.4640445}},
    "input": "2017-04-15T14:57:58.468Z,2,129025,3,255,8,82,9f,49,17,43,83,6c,d2"
  },
  {
    "expected": {"prio":2,"pgn":129025,"dst":255,"src":5,"timestamp":"2023-07-22T15:58:03.514Z","fields":{"Longitude":null,"Latitude":null },"description":"Position, Rapid Update"},
    "input": "2023-07-22T15:58:03.514Z,2,129025,5,255,8,fe,ff,ff,7f,fe,ff,ff,7f",
    "skipEncoderTest": true
  }
]
