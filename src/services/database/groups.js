import { groups } from './json.js'

const now = () => new Date().toISOString()

export function getGroupKey(jid) {
    const value = String(jid || '').trim()
    return value.endsWith('@g.us') ? value : null
}

export function getGroup(jid) {
    const key = getGroupKey(jid)
    return key ? groups.get(key) : null
}

export function upsertGroup({ jid, name = '', settings } = {}) {
    const key = getGroupKey(jid)
    if (!key) return null

    const existing = groups.get(key)
    const record = {
        jid: key,
        name: String(name || existing?.name || ''),
        createdAt: existing?.createdAt || now(),
        settings: settings && typeof settings === 'object'
            ? settings
            : (existing?.settings && typeof existing.settings === 'object' ? existing.settings : {})
    }

    const isNew = !existing
    const changed = isNew ||
        record.name !== existing.name ||
        JSON.stringify(record.settings) !== JSON.stringify(existing.settings)

    if (changed) groups.set(key, record)
    return record
}
