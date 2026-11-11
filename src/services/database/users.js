import { users } from './json.js'
import { toUserJid, toNumber, toLidJid } from '../../utils/identity.js'
import { peekPNForLID } from '../identity-resolver.js'
import { getDailyLimit } from '../config.js'

const now = () => new Date().toISOString()

export function getUserKey(jid) {
    const value = String(jid || '').trim()
    if (!value) return null

    const pn = toUserJid(value)
    if (pn) return toNumber(pn)

    const lid = toLidJid(value)
    if (lid) {
        const mappedPn = peekPNForLID(lid)
        return mappedPn ? toNumber(mappedPn) : lid
    }

    return toNumber(value)
}

export function getUser(jid) {
    const key = getUserKey(jid)
    return key ? users.get(key) : null
}

export function upsertUser({ jid, name = '', isPremium = false, isOwner = false, isCreator = false } = {}) {
    const canonicalJid = toUserJid(jid) || toLidJid(jid) || String(jid || '').trim()
    const key = getUserKey(canonicalJid)
    if (!key) return null

    const existing = users.get(key)
    const timestamp = now()
    const record = {
        jid: canonicalJid,
        name: String(name || existing?.name || ''),
        firstSeen: existing?.firstSeen || timestamp,
        lastSeen: timestamp,
        limit: Number.isFinite(existing?.limit) ? existing.limit : getDailyLimit(),
        premium: !!(isPremium || existing?.premium),
        owner: !!(isOwner || existing?.owner),
        creator: !!(isCreator || existing?.creator)
    }

    const isNew = !existing
    const fieldsChanged = !isNew && (
        record.name !== existing.name ||
        record.limit !== existing.limit ||
        record.premium !== existing.premium ||
        record.owner !== existing.owner ||
        record.creator !== existing.creator
    )

    if (isNew || fieldsChanged) {
        users.set(key, record)
    } else {
        users.touch(key, { lastSeen: record.lastSeen })
    }

    return record
}

export function consumeUserLimit(jid, cost = 1) {
    const key = getUserKey(jid)
    if (!key) return null

    const existing = users.get(key)
    if (!existing) return null

    const current = Number.isFinite(existing.limit) ? existing.limit : 0
    const record = { ...existing, limit: Math.max(0, current - cost), lastSeen: now() }
    users.set(key, record)
    return record
}

export function resetAllUserLimits(defaultLimit) {
    const all = users.all()
    const keys = Object.keys(all)
    for (const key of keys) {
        all[key] = { ...all[key], limit: defaultLimit }
    }
    if (keys.length > 0) users.setAll(all)
    return keys.length
}
