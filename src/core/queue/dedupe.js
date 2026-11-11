const seen = new Map()
const TTL = 30_000
const MAX = 2_000

export function isDuplicateMessage(id) {
    if (!id) return false
    const key = String(id)
    const now = Date.now()

    for (const [oldId, timestamp] of seen) {
        if (now - timestamp > TTL) seen.delete(oldId)
    }

    if (seen.has(key)) return true
    seen.set(key, now)

    while (seen.size > MAX) {
        const oldest = seen.keys().next().value
        if (oldest === undefined) break
        seen.delete(oldest)
    }

    return false
}
