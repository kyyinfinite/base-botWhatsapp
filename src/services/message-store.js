import { outgoingMessages } from './database/json.js'

const store = new Map()

const MAX_ENTRIES = 500
const TTL_MS = 60 * 60_000

let loaded = false

function ensureLoaded() {
    if (loaded) return
    loaded = true
    try {
        const all = outgoingMessages.all()
        const entries = Object.entries(all)
            .filter(([, record]) => record?.id && record?.content)
            .sort((a, b) => (a[1].at || 0) - (b[1].at || 0))
        for (const [, record] of entries) {
            store.set(record.id, record)
        }
        prune()
    } catch {}
}

function removeFromDisk(id) {
    try {
        outgoingMessages.delete(id)
    } catch {}
}

function prune() {
    const now = Date.now()
    for (const [id, record] of store) {
        if (now - (record.at || 0) > TTL_MS) {
            store.delete(id)
            removeFromDisk(id)
        }
    }
    while (store.size > MAX_ENTRIES) {
        const oldest = store.keys().next().value
        store.delete(oldest)
        removeFromDisk(oldest)
    }
}

export function storeOutgoingMessage(key, content) {
    if (!key?.id || !content || typeof content !== 'object') return false

    ensureLoaded()

    const record = { id: key.id, jid: key.remoteJid || null, content, at: Date.now() }
    store.delete(key.id)
    store.set(key.id, record)

    try {
        outgoingMessages.set(key.id, record)
    } catch {}

    prune()
    return true
}

export function getMessageForRetry(key) {
    const id = key?.id
    if (!id) return undefined

    ensureLoaded()

    const record = store.get(id)
    if (!record) return undefined

    if (Date.now() - (record.at || 0) > TTL_MS) {
        store.delete(id)
        removeFromDisk(id)
        return undefined
    }

    store.delete(id)
    store.set(id, record)
    return record.content
}

export function getMessageStoreStats() {
    ensureLoaded()
    return { entries: store.size, max: MAX_ENTRIES, ttlMs: TTL_MS }
}

export function resetMessageStore() {
    store.clear()
    loaded = false
    try {
        outgoingMessages.setAll({})
    } catch {}
}
