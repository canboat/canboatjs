
const net = require('net')
const Transform = require('stream').Transform
const mqtt = require('mqtt');
const debug = require('debug')('venus-mqtt')
//const pgns = require('./fromPgn').pgns
const _ = require('lodash')

function MQTTStream (options) {
  Transform.call(this, {
    objectMode: true
  })
  this.options = options
}

require('util').inherits(MQTTStream, Transform)

MQTTStream.prototype.discoveryAvailable = function() {
  return moduleAvailable('md' + 'ns');
};

function mysleep(millis) {
    return new Promise(resolve => setTimeout(resolve, millis));
}

MQTTStream.prototype.pipe = function (pipeTo) {
  const that = this
  this.startDiscovery().then(service => {
    let url = service.txtRecord.mqtt_broker
    var client = mqtt.connect(url)
    client.on('connect', function () {
      debug(`connected to ${url}`)

      client.subscribe('n2k/mqtt_n2k/self')
      //client.subscribe('n2k/mqtt_n2k/listenpgns')
      client.publish('n2k/mqtt_n2k/getself')
      client.publish('n2k/mqtt_n2k/addpgn', '129026')
      client.publish('n2k/mqtt_n2k/addpgn', '129025')
      //client.publish('n2k/mqtt_n2k/getlistenpgns')
      client.subscribe('n2k/mqtt_n2k/bus/#')

      /*
      pgns.forEach(key => {
        debug(`adding pgn ${key}`)
        client.publish('n2k/mqtt_n2k/addpgn', key)
        //require('sleep').msleep(100)
      })
      */
      
    })

    client.on('error', error => {
      this.options.app.setProviderError(`error connecting to mqtt ${error}`)
    })

    client.on('close', () => {
      this.options.app.setProviderError(`mqtt close`)
    });

    client.on('reconnect', () => {
      //this.(`mqtt reconnect`)
    });

    client.on('message', (topic, json) => {
      debug(`${topic}: '${json}'`)
      const pgn = JSON.parse(json);
      if ( topic.startsWith('n2k/mqtt_n2k/bus/') ) {
        that.push(pgn)
      }
    })
  }).catch(error => {
    debug(error)
    this.options.app.setProviderStatus(error.msg)
  })
    
  Transform.prototype.pipe.call(this, pipeTo)
}

MQTTStream.prototype.startDiscovery = function() {
  var that = this;
  return new Promise(function(resolve, reject) {
    if (!that.discoveryAvailable()) {
      console.log(
        "Discovery requires mdns or specify hostname and port"
      );
      reject('Discovery requires mdns');
    }
    
    var mdns = require('md' + 'ns');
    
    function doStart(serviceName) {
      let browser = mdns.createBrowser(mdns.tcp(serviceName), {
        resolverSequence: [mdns.rst.DNSServiceResolve()],
      });
      browser.on('serviceUp', function(service) {
        debug(`Discovered ${serviceName}:` + JSON.stringify(service, null, 2));
        //that.get('/signalk', service.host, service.port, isHttps ? 'https' : 'http').then(function(response) {
        debug(`Service at ${service.host}:${service.port} ${service.txtRecord.base_topic}`)
        resolve(service)
      });
      debug(`Starting ${serviceName} discovery`);
      browser.start();
      return browser
    }
    
    this.browser = doStart('mqtt-n2k')
  })
}
                   

MQTTStream.prototype._transform = function (data, encoding, callback) {}

function moduleAvailable(name) {
  try {
    require.resolve(name);
    return true;
  } catch (e) {}
  return false;
}

module.exports = MQTTStream

const pgns = [ '126992','127505','129029','129291','130312','127245','127506','129038','129793','130314','127250','127508','129039','129794','130577','127251','128259','129040','129809','130842','127257','128267','129041','129810','127258','128275','129283','130306','127488','129025','129284','130310','127489','129026','129285','130311']
