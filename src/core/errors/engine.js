import { events } from '../events/engine.js'

export function reportPluginError(scope, error, context = {}) {
    const err = error instanceof Error ? error : new Error(String(error))
    console.error(`[${scope}]`, err)
    events.emit('bot:error', { scope, error: err, context })
    return err
}
