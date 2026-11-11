import connectToWhatsApp, { closeActiveSocket, getActiveSocket } from './src/core/app/connect.js'
import { startLimitResetScheduler } from './src/core/scheduler/limitReset.js'
import { flushAll } from './src/services/database/index.js'
import { startScheduler, stopScheduler } from './src/services/scheduler.js'
import { startConversationSweeper } from './src/services/conversation-state.js'

startLimitResetScheduler()
startConversationSweeper()

startScheduler({
    sender: async (chatJid, content) => {
        const sock = getActiveSocket()
        if (!sock || typeof sock.sendMessage !== 'function') {
            throw new Error('socket WhatsApp tidak aktif')
        }
        await sock.sendMessage(chatJid, content)
    }
}).catch(error => console.error('[SCHEDULER] Gagal start:', error.message))

let shuttingDown = false

function shutdown(signal) {
    if (shuttingDown) return
    shuttingDown = true

    console.log(`[SHUTDOWN] Received ${signal}, flushing database and exiting.`)

    stopScheduler()

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
