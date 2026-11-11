import { isJidStatus, isJidBroadcast, isJidNewsletter } from '../../utils/jid.js'

export function isDispatchableUpsertType(type) {
    return type === 'notify'
}

export function isDispatchableMessage(mek) {
    if (!mek?.message) return false

    const jid = mek.key?.remoteJid
    if (!jid) return false
    if (isJidStatus(jid) || isJidBroadcast(jid) || isJidNewsletter(jid)) return false

    if (mek.key?.id?.startsWith('BAE5') && mek.key.id.length === 16) return false

    return true
}
