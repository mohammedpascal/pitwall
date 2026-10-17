// A tiny HTTP server so the sample project has something real to start and stop.
import http from 'node:http'

const port = Number(process.env.PORT) || 4310
http
  .createServer((req, res) => {
    console.log(`${req.method} ${req.url} 200`)
    res.end('sample api ok\n')
  })
  .listen(port, () => console.log(`Sample API ready at http://localhost:${port}`))

setInterval(() => console.log(`heartbeat ${new Date().toLocaleTimeString()}`), 5000)
