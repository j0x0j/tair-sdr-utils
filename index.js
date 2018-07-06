const rtlsdr = require('rtlsdr')

rtlsdr.getDevices((err, devices) => {
  if (err) console.log(err)
  devices[0].open((err, device) => {
    if (err) console.log(err)
    device.setSampleRate(2048000)
    device.setCenterFrequency(99500000)
    device.on('data', (data) => {
      // process data
      console.log(data)
    })
    device.start()
    setTimeout(() => {
      device.stop()
    }, 1000)
  })
})
