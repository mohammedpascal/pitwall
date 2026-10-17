import http from 'node:http'

const port = Number(process.env.PORT) || 4311
console.warn('warning: using sample data, no API key configured')
http
  .createServer((req, res) => {
    console.log(`GET ${req.url}`)
    res.setHeader('content-type', 'text/html')
    res.end('<h1>Sample website</h1>')
  })
  .listen(port, () => console.log(`Website ready at http://localhost:${port}`))
