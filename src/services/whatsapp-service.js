const VALID_PRESENCE = ['unavailable', 'available', 'composing', 'recording', 'paused']

const requireConn = conn => {
    if (!conn || typeof conn.sendMessage !== 'function') {
        throw new TypeError('conn.sendMessage tidak tersedia')
    }
    return conn
}

const requireJid = jid => {
    const value = String(jid || '').trim()
    if (!value) throw new TypeError('jid tidak boleh kosong')
    return value
}

const requireMessage = m => {
    if (!m?.key?.remoteJid) throw new TypeError('pesan tidak memiliki key.remoteJid')
    return m
}

export async function sendMessage(conn, jid, content, options = {}) {
    requireConn(conn)
    const target = requireJid(jid)
    if (!content || typeof content !== 'object') throw new TypeError('content harus berupa object')
    return conn.sendMessage(target, content, options)
}

export async function replyMessage(conn, m, content, options = {}) {
    requireMessage(m)
    return sendMessage(conn, m.key.remoteJid, content, { quoted: m, ...options })
}

export async function reactToMessage(conn, m, emoji = '') {
    requireMessage(m)
    return sendMessage(conn, m.key.remoteJid, {
        react: { text: String(emoji ?? ''), key: m.key }
    })
}

export async function editMessage(conn, key, text) {
    if (!key?.remoteJid) throw new TypeError('key.remoteJid tidak ada untuk edit')
    requireConn(conn)
    return conn.sendMessage(key.remoteJid, { text: String(text ?? ''), edit: key })
}

export async function deleteForEveryone(conn, key) {
    if (!key?.remoteJid) throw new TypeError('key.remoteJid tidak ada untuk delete')
    requireConn(conn)
    return conn.sendMessage(key.remoteJid, { delete: key })
}

export async function forwardMessage(conn, jid, m, { force = false } = {}) {
    requireMessage(m)
    if (!m.message) throw new TypeError('pesan tanpa konten tidak dapat diteruskan')
    return sendMessage(conn, jid, { forward: { key: m.key, message: m.message }, force })
}

export async function setPresence(conn, type, toJid) {
    if (typeof conn?.sendPresenceUpdate !== 'function') {
        throw new TypeError('conn.sendPresenceUpdate tidak tersedia')
    }
    if (!VALID_PRESENCE.includes(type)) {
        throw new TypeError(`presence tidak valid: ${type}`)
    }
    return conn.sendPresenceUpdate(type, toJid)
}

export async function sendTyping(conn, jid, { duration = 2000 } = {}) {
    const target = requireJid(jid)
    await setPresence(conn, 'composing', target)

    const timer = setTimeout(() => {
        conn.sendPresenceUpdate('paused', target).catch(() => {})
    }, Math.max(0, duration))
    timer.unref?.()

    return () => {
        clearTimeout(timer)
        return conn.sendPresenceUpdate('paused', target).catch(() => {})
    }
}

export async function markRead(conn, keys) {
    if (typeof conn?.readMessages !== 'function') {
        throw new TypeError('conn.readMessages tidak tersedia')
    }
    const list = Array.isArray(keys) ? keys.filter(Boolean) : [keys].filter(Boolean)
    if (!list.length) throw new TypeError('keys tidak boleh kosong')
    return conn.readMessages(list)
}
