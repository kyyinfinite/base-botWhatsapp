import {
    jidNormalizedUser,
    jidDecode,
    isPnUser,
    isJidGroup as _isJidGroup,
    isJidBroadcast as _isJidBroadcast,
    isJidNewsletter as _isJidNewsletter,
    isLidUser as _isLidUser,
    isJidStatusBroadcast
} from '@whiskeysockets/baileys'


export const isJidUser = jid =>
    !!jid && !!isPnUser(jid)


export const isJidGroup = jid =>
    !!jid && !!_isJidGroup(jid)


export const isJidBroadcast = jid =>
    !!jid && !!_isJidBroadcast(jid)


export const isJidNewsletter = jid =>
    !!jid && !!_isJidNewsletter(jid)


export const isJidStatus = jid =>
    !!jid && isJidStatusBroadcast(jid)


export const isLidUser = jid =>
    !!jid && !!_isLidUser(jid)


export const normalizeJid = jid => {
    if (!jid) return jid

    try {
        return jidNormalizedUser(jid)
    } catch {
        return jid
    }
}


export const decodeJid = jid => {
    if (!jid) return undefined

    try {
        return jidDecode(jid)
    } catch {
        return undefined
    }
}


export const normalizeLid = jid => {
    if (!jid) return jid

    try {
        const decoded = jidDecode(jid)

        if (!decoded?.user || !decoded?.server) {
            return jid
        }

        return `${decoded.user}@${decoded.server}`
    } catch {
        return jid
    }
}


export const jidToUser = jid => {
    const decoded = decodeJid(jid)
    return decoded?.user || null
}


export const jidToServer = jid => {
    const decoded = decodeJid(jid)
    return decoded?.server || null
}


export const jidToNumber = jid => {
    const user = jidToUser(jid)
    return user || null
}


export const getJidType = jid => {
    if (!jid) return 'unknown'

    if (isJidStatus(jid)) return 'status'
    if (isJidGroup(jid)) return 'group'
    if (isJidBroadcast(jid)) return 'broadcast'
    if (isLidUser(jid)) return 'lid'
    if (isJidUser(jid)) return 'user'

    return 'unknown'
}