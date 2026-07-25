import { parentPort, workerData } from 'worker_threads'
import { runMaintenanceAtRoot } from './indexCompaction.js'

process.env.FS = workerData.root

let options = { ...workerData.options }
let timer
let wakeTimer
let running = false

async function run() {
  if (running) return
  running = true
  try {
    await runMaintenanceAtRoot(workerData.root, options)
  } catch (_) {
    // Maintenance is best-effort; the next interval safely retries.
  } finally {
    running = false
  }
}

function scheduleInterval() {
  clearInterval(timer)
  timer = setInterval(run, options.intervalMs)
  timer.unref()
}

parentPort.on("message", (message) => {
  if (message?.type === "configure") {
    options = { ...options, ...message.options }
    scheduleInterval()
  }
  if (message?.type === "wake") {
    clearTimeout(wakeTimer)
    wakeTimer = setTimeout(run, 250)
    wakeTimer.unref()
  }
})

scheduleInterval()
