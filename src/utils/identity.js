import {
    jidNormalizedUser,
    isPnUser,
    isLidUser,
    isHostedPnUser,
    isHostedLidUser,
    isJidGroup,
    isJidBroadcast,
    isJidNewsletter
} from '@whiskeysockets/baileys'

const PN_SERVERS = new Set(['s.whatsapp.net', 'hosted'])

const cleanNumber = value => {
    if (!value) return null

    const raw = String(value).trim()
    if (!raw) return null

    const at = raw.indexOf('@')

    if (at >= 0) {
        const server = raw.slice(at + 1).toLowerCase()
        if (!PN_SERVERS.has(server)) return null
        const user = raw.slice(0, at).split(':')[0]
        const digits = user.replace(/[^0-9]/g, '')
        return digits || null
    }

    const digits = raw.replace(/[^0-9]/g, '')
    return digits || null
}

export const toNumber = value => cleanNumber(value)

export const toUserJid = value => {
    if (!value) return null

    const raw = String(value).trim()

    try {
        const jid = jidNormalizedUser(raw)
        if (isPnUser(jid)) return jid
    } catch {}

    if (raw.includes('@') && !isPersonalJid(raw)) return null

    const number = cleanNumber(raw)
    return number ? `${number}@s.whatsapp.net` : null
}

export const toLidJid = value => {
    if (!value) return null

    try {
        const jid = jidNormalizedUser(String(value).trim())
        return isLidUser(jid) ? jid : null
    } catch {
        return null
    }
}

export const getConfiguredNumbers = values => {
    const list = Array.isArray(values) ? values : [values]
    return [...new Set(list.map(toNumber).filter(Boolean))]
}

export function isPersonalJid(jid) {
    if (!jid) return false

    const raw = String(jid).trim()
    if (!raw) return false

    return !!(
        isPnUser(raw) ||
        isLidUser(raw) ||
        isHostedPnUser(raw) ||
        isHostedLidUser(raw)
    )
}

export const isGroupJid = jid => !!jid && !!isJidGroup(String(jid))
export const isBroadcastJid = jid => !!jid && (!!isJidBroadcast(String(jid)) || String(jid) === 'status@broadcast')
export const isNewsletterJid = jid => !!jid && !!isJidNewsletter(String(jid))

export function normalizePersonalJid(jid) {
    if (!jid) return null

    const raw = String(jid).trim()
    if (!raw || !isPersonalJid(raw)) return null

    try {
        return jidNormalizedUser(raw)
    } catch {
        return null
    }
}
