import { events } from '../events/engine.js'
import { logError } from '../../services/logger.js'

export function reportPluginError(scope, error, context = {}) {
    const err = error instanceof Error ? error : new Error(String(error))
    console.error(`[${scope}]`, err)
    logError('error-engine', 'plugin.error', { scope, message: err.message, context })
    events.emit('bot:error', { scope, error: err, context })
    return err
}
