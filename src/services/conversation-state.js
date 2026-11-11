const states = new Map()

const DEFAULT_TTL_MS = 5 * 60_000
const MAX_STATES = 1000

const stateKey = (chatKey, name) => `${String(chatKey || '')}|${String(name || '')}`

function evictOldest() {
    if (states.size <= MAX_STATES) return
    for (const key of states.keys()) {
        states.delete(key)
        if (states.size <= MAX_STATES) break
    }
}

export function setConversationState(chatKey, name, value, ttlMs = DEFAULT_TTL_MS) {
    const key = stateKey(chatKey, name)
    if (!String(chatKey || '') || !String(name || '')) {
        throw new TypeError('chatKey dan name tidak boleh kosong')
    }
    const ttl = Number(ttlMs)
    if (!Number.isFinite(ttl) || ttl <= 0) throw new TypeError('ttlMs harus angka positif')

    states.delete(key)
    states.set(key, { value, expiresAt: Date.now() + ttl })
    evictOldest()
    return value
}

export function getConversationState(chatKey, name) {
    const key = stateKey(chatKey, name)
    const entry = states.get(key)
    if (!entry) return null

    if (Date.now() > entry.expiresAt) {
        states.delete(key)
        return null
    }

    states.delete(key)
    states.set(key, entry)
    return entry.value
}

export function clearConversationState(chatKey, name) {
    return states.delete(stateKey(chatKey, name))
}

export function clearChatStates(chatKey) {
    const prefix = `${String(chatKey || '')}|`
    let removed = 0
    for (const key of [...states.keys()]) {
        if (key.startsWith(prefix)) {
            states.delete(key)
            removed += 1
        }
    }
    return removed
}

export function sweepExpiredStates(now = Date.now()) {
    let removed = 0
    for (const [key, entry] of states) {
        if (now > entry.expiresAt) {
            states.delete(key)
            removed += 1
        }
    }
    return removed
}

export function getConversationStats() {
    return { entries: states.size, max: MAX_STATES, defaultTtlMs: DEFAULT_TTL_MS }
}

export function resetConversationState() {
    states.clear()
}

export function startConversationSweeper(intervalMs = 60_000) {
    const timer = setInterval(() => {
        try {
            sweepExpiredStates()
        } catch {}
    }, intervalMs)
    timer.unref?.()
    return () => clearInterval(timer)
}
