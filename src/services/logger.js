const entries = []

const MAX_ENTRIES = 500
const MAX_DATA_STRING = 500

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 }

function sanitizeValue(value) {
    if (value instanceof Error) {
        return { name: value.name, message: String(value.message).slice(0, MAX_DATA_STRING) }
    }
    if (typeof value === 'string') {
        return value.length > MAX_DATA_STRING ? `${value.slice(0, MAX_DATA_STRING)}…` : value
    }
    if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) {
        return value
    }
    if (Array.isArray(value)) {
        return value.slice(0, 20).map(item => sanitizeValue(item))
    }
    if (typeof value === 'object') {
        const out = {}
        for (const [key, item] of Object.entries(value).slice(0, 30)) {
            out[key] = sanitizeValue(item)
        }
        return out
    }
    return String(value).slice(0, MAX_DATA_STRING)
}

export function logStructured(level, subsystem, event, data = {}) {
    const normalized = LEVELS[level] ? level : 'info'
    const entry = {
        ts: Date.now(),
        level: normalized,
        subsystem: String(subsystem || 'unknown').slice(0, 60),
        event: String(event || 'unknown').slice(0, 120),
        data: sanitizeValue(data && typeof data === 'object' ? data : { value: data })
    }

    entries.push(entry)
    if (entries.length > MAX_ENTRIES) {
        entries.splice(0, entries.length - MAX_ENTRIES)
    }

    return entry
}

export const logDebug = (subsystem, event, data) => logStructured('debug', subsystem, event, data)
export const logInfo = (subsystem, event, data) => logStructured('info', subsystem, event, data)
export const logWarn = (subsystem, event, data) => logStructured('warn', subsystem, event, data)
export const logError = (subsystem, event, data) => logStructured('error', subsystem, event, data)

export function getRecentLogs({ level, subsystem, limit = 100 } = {}) {
    const minLevel = LEVELS[level] ?? 0
    const filtered = entries.filter(entry =>
        LEVELS[entry.level] >= minLevel &&
        (!subsystem || entry.subsystem === subsystem)
    )
    const count = Number.isFinite(limit) && limit > 0 ? limit : 100
    return filtered.slice(-count)
}

export function getLogStats() {
    const byLevel = { debug: 0, info: 0, warn: 0, error: 0 }
    for (const entry of entries) {
        byLevel[entry.level] += 1
    }
    return { entries: entries.length, max: MAX_ENTRIES, byLevel }
}

export function clearLogs() {
    entries.length = 0
}
