var rtlsdr = require('rtlsdr');

rtlsdr.getDevices(function (err, devices) {
  devices[0].open(function (err, device) {
    device.setSampleRate(2048000);
    device.setCenterFrequency(99500000);
    device.on("data", function (data) {
      // process data
      console.log(data);
    });
    device.start();
    setTimeout(function () {
      device.stop();
    }, 1000);
  });
});
