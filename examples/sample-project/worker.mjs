// Processes a few jobs, then crashes, so you can try "Send to tasks".
let job = 0
const timer = setInterval(() => {
  job += 1
  console.log(`processing job #${job}`)
  if (job === 4) {
    clearInterval(timer)
    const payload = {}
    payload.items.map((x) => x) // crashes on purpose
  }
}, 1500)
