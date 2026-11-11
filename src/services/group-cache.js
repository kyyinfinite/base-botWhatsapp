const cache = new Map()
const TTL_MS = 5 * 60_000
const MAX_ENTRIES = 500

let boundSocket = null

export function setGroupCacheSocket(sock) {
    boundSocket = sock || null
}

export function getGroupCacheStats() {
    return { entries: cache.size, ttlMs: TTL_MS, max: MAX_ENTRIES }
}

export function resetGroupCache() {
    cache.clear()
}

function cloneMetadata(metadata) {
    if (!metadata) return undefined
    try {
        return JSON.parse(JSON.stringify(metadata))
    } catch {
        return undefined
    }
}

async function fetchMetadata(conn, jid) {
    if (!conn?.groupMetadata) return undefined
    try {
        return await conn.groupMetadata(jid)
    } catch {
        return undefined
    }
}

function trimCache() {
    if (cache.size <= MAX_ENTRIES) return
    for (const key of cache.keys()) {
        cache.delete(key)
        if (cache.size <= MAX_ENTRIES) break
    }
}

export async function getCachedGroupMetadata(jid, conn = boundSocket) {
    const key = String(jid || '')
    if (!key) return undefined

    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < TTL_MS) return cloneMetadata(hit.metadata)

    const metadata = await fetchMetadata(conn, key)
    if (metadata) {
        cache.delete(key)
        cache.set(key, { metadata, at: Date.now() })
        trimCache()
    } else {
        cache.delete(key)
    }

    return cloneMetadata(metadata)
}

export function captureGroupMetadata(metadata, jid) {
    if (!metadata) return
    const key = String(jid || metadata.id || '')
    if (!key) return
    cache.delete(key)
    cache.set(key, { metadata, at: Date.now() })
    trimCache()
}

export function invalidateGroupMetadata(jid) {
    if (!jid) return
    cache.delete(String(jid))
}
