module.exports = [
  {
    "expected": {"timestamp":"2017-04-15T14:57:58.470Z","prio":3,"src":3,"dst":255,"pgn":129029,"description":"GNSS Position Data","fields":{"SID":155,"Date":"2017.04.15", "Time": "14:57:56.89500","Latitude":39.0700875,"Longitude":-76.4640319,"GNSS type":"GPS+SBAS/WAAS","Method":"DGNSS fix","Integrity":"No integrity checking","Number of SVs":18,"HDOP":0.65,"Reference Stations": 0, "list":[]}},
    "input":"2017-04-15T14:57:58.470Z,3,129029,3,255,43,9b,77,43,36,f6,1c,20,00,2e,cf,33,60,0c,6c,05,ff,49,10,5d,ae,73,63,f5,ff,ff,ff,ff,ff,ff,ff,7f,23,fc,12,41,00,ff,7f,ff,ff,ff,7f,00"
  },
  {
    "expected": {"canId":234358051,"prio":3,"src":35,"dst":255,"pgn":129029,"fields":{"SID":126,"Date":"2020.03.09","Time":"17:47:47.80000","Latitude":42.4913166,"Longitude":-70.8850733,"Altitude":41.4,"GNSS type":"GPS+SBAS/WAAS","Method":"DGNSS fix","Integrity":"No integrity checking","Number of SVs":10,"HDOP":0.9,"PDOP":1.6,"Geoidal Separation":-30.9,"Reference Stations":0,"list":[{"Reference Station ID":15}]},"description":"GNSS Position Data"},
    "format": 0,
    "input": ['can0  0DF80523   [8]  C0 2B 7E 9A 47 70 F8 2F',
              'can0  0DF80523   [8]  C1 26 00 0C D1 EF 45 98',
              'can0  0DF80523   [8]  C2 E5 05 00 7E C2 94 03',
              'can0  0DF80523   [8]  C3 A8 29 F6 C0 B6 77 02',
              'can0  0DF80523   [8]  C4 00 00 00 00 23 FC 0A',
              'can0  0DF80523   [8]  C5 5A 00 A0 00 EE F3 FF',
              'can0  0DF80523   [8]  C6 FF 00 FF FF FF FF FF']
  },
  {
    "expected": {"prio":3,"pgn":129029,"dst":255,"src":5,"timestamp":"2023-07-22T15:25:03.923Z", "fields":{"Date":"2023.07.22","GNSS type":"GPS+SBAS/WAAS+GLONASS","Method":"GNSS fix","Integrity":"No integrity checking","Number of SVs":0,"Reference Stations":0,"list":[]},"description":"GNSS Position Data"},
    "input": "2023-07-22T15:25:03.923Z,3,129029,5,255,43,ff,68,4c,fe,ff,ff,ff,fe,ff,ff,ff,ff,ff,ff,7f,fe,ff,ff,ff,ff,ff,ff,7f,fe,ff,ff,ff,ff,ff,ff,7f,14,fc,00,fe,7f,fe,7f,fe,ff,ff,7f,00",
    "skipEncoderTest": true
  }
]
