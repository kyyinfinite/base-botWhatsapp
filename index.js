import connectToWhatsApp, { closeActiveSocket } from './src/core/app/connect.js'
import { startLimitResetScheduler } from './src/core/scheduler/limitReset.js'
import { flushAll } from './src/services/database/index.js'

startLimitResetScheduler()

let shuttingDown = false

function shutdown(signal) {
    if (shuttingDown) return
    shuttingDown = true

    console.log(`[SHUTDOWN] Received ${signal}, flushing database and exiting.`)

    try {
        flushAll()
    } catch (error) {
        console.error('[SHUTDOWN] Database flush failed:', error.message)
    }

    closeActiveSocket().finally(() => process.exit(0))
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('unhandledRejection', (reason) => {
    console.error('[UNHANDLED REJECTION]', reason)
})

connectToWhatsApp()
