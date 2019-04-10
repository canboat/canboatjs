## Change Log

### v1.5.2 (2019/04/10 12:29 +00:00)
- [#55](https://github.com/canboat/canboatjs/pull/55) fix: make iKonvert and YDGW emit nmea2000OutAvailable (@sbender9)
- [#54](https://github.com/canboat/canboatjs/pull/54) fix: some proprietary pgns not getting parsed with the YDGW (@sbender9)
- [#53](https://github.com/canboat/canboatjs/pull/53) fix: YDGW output broken (@sbender9)

### v1.5.1 (2019/04/08 21:25 +00:00)
- [#52](https://github.com/canboat/canboatjs/pull/52) fix: issues with the YDWG (@sbender9)
- [#51](https://github.com/canboat/canboatjs/pull/51) feature: add support NMEA 2000 via MQTT on Venus (@sbender9)

### v1.5.0 (2019/04/04 13:53 +00:00)
- [#50](https://github.com/canboat/canboatjs/pull/50) feature: add the ability for to ouput to the YDWG-02 (@jncarter123)

### v1.4.0 (2019/03/19 17:34 +00:00)
- [#48](https://github.com/canboat/canboatjs/pull/48) feature: add callback interface to parse (@tkurki)

### v1.3.1 (2019/03/04 14:49 +00:00)
- [#47](https://github.com/canboat/canboatjs/pull/47) fix: YDWG date parse error (@jncarter123)

### v1.3.0 (2019/02/26 19:36 +00:00)
- [#45](https://github.com/canboat/canboatjs/pull/45) refactor: pcdin implmentation (@sbender9)
- [#44](https://github.com/canboat/canboatjs/pull/44) refactor: Yacht Devices RAW format code cleanup. #42 (@webmasterkai)
- [#43](https://github.com/canboat/canboatjs/pull/43) feature: add support for Yacht Devices NMEA 2000 Wi-Fi Gateway (@sbender9)
- [#40](https://github.com/canboat/canboatjs/pull/40) fix: Handle offset values (@webmasterkai)
- [#38](https://github.com/canboat/canboatjs/pull/38) style: whitespace (@webmasterkai)
- [#39](https://github.com/canboat/canboatjs/pull/39) chore: Edit git and editor config (@webmasterkai)

### v1.2.1 (2018/12/12 21:08 +00:00)
- [#28](https://github.com/canboat/canboatjs/pull/28) feature: add support for Digital Yacht’s iKonvert (@sbender9)
- [#36](https://github.com/canboat/canboatjs/pull/36) chore: make serialport an optional dependency (@tkurki)

### v1.1.10 (2018/12/12 19:52 +00:00)
- [#37](https://github.com/canboat/canboatjs/pull/37) fix: new bit-buffer release breaks reading n2k data (@sbender9)

### v1.1.9 (2018/11/06 19:57 +00:00)
- [#34](https://github.com/canboat/canboatjs/pull/34) fix: changes in canboat to 130306 and 129029 broke n2k output (@sbender9)

### v1.1.8 (2018/11/02 14:33 +00:00)
- [#33](https://github.com/canboat/canboatjs/pull/33)  fix: revert timestamp change #31 (@sbender9)

### v1.1.7 (2018/10/31 19:24 +00:00)
- [#32](https://github.com/canboat/canboatjs/pull/32) fix: definition for 127501 (Binary Switch Bank Status) was wrong (@sbender9)
- [#31](https://github.com/canboat/canboatjs/pull/31) fix: timestamps from actisense log files not formatted properly (@sbender9)

### v1.1.6 (2018/10/21 17:55 +00:00)
- [#30](https://github.com/canboat/canboatjs/pull/30)  chore: update pgns.json to include Airmar: Speed Pulse Count (@sbender9)

### v1.1.5 (2018/10/14 17:28 +00:00)
- [#27](https://github.com/canboat/canboatjs/pull/27) chore: update to the latest pgn definitions from canboat (@sbender9)
- [#26](https://github.com/canboat/canboatjs/pull/26) fix: issues with address claims not being handled properly (@sbender9)
- [#24](https://github.com/canboat/canboatjs/pull/24) chore: add debugging of toPgn conversion results (@sbender9)

### v1.1.4 (2018/09/13 14:05 +00:00)
- [#23](https://github.com/canboat/canboatjs/pull/23) fix: allow input to be in both "fast" and "plain" (@sbender9)

### v1.1.3 (2018/09/12 19:17 +00:00)
- [#22](https://github.com/canboat/canboatjs/pull/22) fix: server crashes if logging is turned on with a canbus device (@sbender9)

### v1.1.2 (2018/09/06 17:35 +00:00)
- [#20](https://github.com/canboat/canboatjs/pull/20) fix: stops working with invalid/unknown/unrecognized data (@sbender9)

### v1.1.1 (2018/08/16 16:08 +00:00)
- [#18](https://github.com/canboat/canboatjs/pull/18) feature: include the actisence device path in the status message (@sbender9)

### v1.1.0 (2018/08/15 17:59 +00:00)
- [#17](https://github.com/canboat/canboatjs/pull/17) feature: provide connection status to the server (@sbender9)

### v1.0.4 (2018/08/12 14:50 +00:00)
- [#16](https://github.com/canboat/canboatjs/pull/16) fix: bin/candumpanalyzerjs not working because of missing fromPgnStream.js (@sbender9)

### v1.0.3 (2018/05/29 19:19 +00:00)
- [#15](https://github.com/canboat/canboatjs/pull/15) fix: actisense input broken when logging is turned on in node server (@sbender9)

### v1.0.1 (2018/04/19 20:46 +00:00)
- [#14](https://github.com/canboat/canboatjs/pull/14) fix: timestamp should be in iso format when parsing $PCDIN sentences (@sarfata)
- [#11](https://github.com/canboat/canboatjs/pull/11) README s/inteded/intended (@webmasterkai)

### v1.0.0 (2018/04/06 15:02 +00:00)
- [#10](https://github.com/canboat/canboatjs/pull/10) feature: add command line actisense serial reader  (@sbender9)

### v0.0.12 (2018/04/01 00:55 +00:00)
- [#8](https://github.com/canboat/canboatjs/pull/8) fix: catch and report exceptions when connecting to canbus (@sbender9)
- [#9](https://github.com/canboat/canboatjs/pull/9)  fix: Alternator Potential should be signed in pgn 127489 (@sbender9)
- [#7](https://github.com/canboat/canboatjs/pull/7) fix: ignore messages sent by myself (@sbender9)
- [#6](https://github.com/canboat/canboatjs/pull/6) feature: add support for $PCDIN (@sbender9)

### v0.0.10 (2018/02/21 22:28 +00:00)
- [#5](https://github.com/canboat/canboatjs/pull/5) feature: add support for "ASCII string starting with length byte" fields (@sbender9)

### v0.0.9 (2018/02/05 02:56 +00:00)
- [#4](https://github.com/canboat/canboatjs/pull/4) feature: support latest node server plugin api (@sbender9)

### v0.0.6 (2018/02/03 12:49 +00:00)
- [#3](https://github.com/canboat/canboatjs/pull/3) Version 0.0.4 (@sbender9)

### v0.0.4 (2018/02/02 23:51 +00:00)
- [#2](https://github.com/canboat/canboatjs/pull/2) feature: use socketcan package for canbus access (@sbender9)

### v0.0.3 (2018/02/02 00:46 +00:00)
- [#1](https://github.com/canboat/canboatjs/pull/1) feature: canbus support (@sbender9)