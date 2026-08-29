module.exports = [
  {
    // A Fusion MS-WB670 whose Installation Description #2 was set to
    // "Matsūra Fæké". STRING_LAU under control byte 1, but the content is
    // UTF-8: c5 ab is U+016B, which Latin-1 cannot represent at all.
    // Read as ascii this decoded to "MatsÅ«ra FÃ¦kÃ©" with the high bits
    // stripped; read as latin1 it would be mojibake. See canboat/canboat#864.
    expected: {
      timestamp: '2026-08-29T12:46:45.747Z',
      prio: 6,
      src: 51,
      dst: 255,
      pgn: 126998,
      description: 'Configuration Information',
      fields: {
        installationDescription1: 'MS-WB670',
        installationDescription2: 'Matsūra Fæké',
        manufacturerInformation: 'Fusion Electronics Ltd'
      }
    },
    input:
      '2026-08-29T12:46:45.747Z,6,126998,51,255,51,0a,01,4d,53,2d,57,42,36,37,30,11,01,4d,61,74,73,c5,ab,72,61,20,46,c3,a6,6b,c3,a9,18,01,46,75,73,69,6f,6e,20,45,6c,65,63,74,72,6f,6e,69,63,73,20,4c,74,64'
  }
]
