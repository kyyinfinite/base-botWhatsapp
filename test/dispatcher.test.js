import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'

const tmpDisp = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-disp-'))
process.env.WA_DATABASE_DIR = tmpDisp
process.env.WA_OWNER_PATH = path.join(tmpDisp, 'owner.json')
process.env.WA_PREMIUM_PATH = path.join(tmpDisp, 'premium.json')
process.env.WA_CONFIG_PATH = path.join(tmpDisp, 'config.json')
fs.writeFileSync(process.env.WA_CONFIG_PATH, JSON.stringify({
    botName: 'Uji Bot',
    botMode: 'public',
    dailyLimit: 5,
    prefix: ['.'],
    creator: [],
    accessDenied: { owner: 'Perintah ini hanya dapat digunakan oleh owner.' }
}))

const { parseCommand, parseButtonResponse, matchPatternPlugin } = await import('../src/core/dispatcher/parse.js')
const { registerPlugin, unregisterPlugin, getKeysOf, metadata } = await import('../src/core/plugin/registry.js')
const { upsertUser, getUser } = await import('../src/services/database/users.js')
const { updateConfig, getConfig } = await import('../src/services/config.js')
const { flushAll } = await import('../src/services/database/json.js')
const handleMessage = (await import('../src/core/dispatcher/dispatcher.js')).default
const { clearCooldowns } = await import('../src/core/middleware/cooldown.js')
const { setResolverSocket, resetResolverState } = await import('../src/services/identity-resolver.js')

const BOT_JID = '628000@s.whatsapp.net'
const USER_JID = '628222@s.whatsapp.net'

const makeConn = () => {
    const sent = []
    return {
        sent,
        user: { id: BOT_JID },
        sendMessage: async (jid, content, opts) => {
            sent.push({ jid, content, opts })
            return {}
        },
        groupMetadata: async () => ({ subject: 'Grup Uji' })
    }
}

const makeM = (text, {
    id = crypto.randomUUID(),
    chat = USER_JID,
    sender = USER_JID,
    fromMe = false,
    button = false,
    remoteJidAlt,
    participantAlt
} = {}) => ({
    key: {
        remoteJid: chat,
        fromMe,
        id,
        participant: chat.endsWith('@g.us') ? sender : undefined,
        remoteJidAlt,
        participantAlt
    },
    id,
    chat,
    sender,
    fromMe,
    isGroup: chat.endsWith('@g.us'),
    pushName: 'Tester',
    message: button
        ? { buttonsResponseMessage: { selectedButtonId: text } }
        : { conversation: text }
})

const pluginsToClean = []

function register(file, handler) {
    registerPlugin(file, handler)
    pluginsToClean.push(file)
    return handler
}

const plugin = (fn, meta = {}) => {
    const handler = async (...args) => fn(...args)
    Object.assign(handler, meta)
    return handler
}

before(() => {
    register('test://ping', plugin(async (m, { conn }) => {
        await conn.sendMessage(m.chat, { text: 'pong' }, { quoted: m })
    }, { command: ['e2eping'] }))

    register('test://owner', plugin(async (m, { conn }) => {
        await conn.sendMessage(m.chat, { text: 'owner-ok' }, { quoted: m })
    }, { command: ['e2eowner'], owner: true }))

    register('test://throw', plugin(async () => {
        throw new Error('boom')
    }, { command: ['e2ethrow'] }))

    register('test://limit', plugin(async (m, { conn }) => {
        await conn.sendMessage(m.chat, { text: 'limit-ok' }, { quoted: m })
    }, { command: ['e2elimit'], limit: 1 }))

    register('test://pattern', plugin(async (m, { conn }) => {
        await conn.sendMessage(m.chat, { text: 'pattern-hit' }, { quoted: m })
    }, { customPrefix: /^=>/ }))

    register('test://loose', plugin(async (m, { conn }) => {
        await conn.sendMessage(m.chat, { text: 'loose-hit' }, { quoted: m })
    }, { customPrefix: /loosekw/ }))

    register('test://cooldown', plugin(async (m, { conn }) => {
        await conn.sendMessage(m.chat, { text: 'cooldown-ok' }, { quoted: m })
    }, { command: ['e2ecooldown'], cooldown: 60_000 }))

    register('test://throwcooldown', plugin(async () => {
        throw new Error('boom')
    }, { command: ['e2ethrowcooldown'], cooldown: 60_000 }))

    register('test://identity', plugin(async (m, { conn }) => {
        await conn.sendMessage(m.chat, {
            text: JSON.stringify({
                sender: m.sender,
                senderPn: m.senderPn || null,
                senderLid: m.senderLid || null,
                identityNumber: m.identityNumber || null,
                identityKey: m.identityKey || null
            })
        }, { quoted: m })
    }, { command: ['e2eidentity'] }))
})

after(() => {
    for (const file of pluginsToClean) {
        unregisterPlugin(file, getKeysOf(file))
    }
    flushAll()
    fs.rmSync(tmpDisp, { recursive: true, force: true })
})

beforeEach(() => {
    clearCooldowns()
    resetResolverState()
    setResolverSocket(null)
})

describe('command parsing', () => {
    test('prefix + command + args', () => {
        const parsed = parseCommand({ text: '.menu 1 2' }, ['.'])
        assert.deepEqual(parsed, { prefix: '.', command: 'menu', args: ['1', '2'], text: '1 2' })
    })

    test('command tanpa prefix jika single word', () => {
        assert.deepEqual(parseCommand({ text: 'menu' }, ['.']), { prefix: '', command: 'menu', args: [], text: '' })
    })

    test('multiword tanpa prefix ditolak', () => {
        assert.equal(parseCommand({ text: 'menu 1 2' }, ['.']), null)
    })

    test('prefix saja ditolak', () => {
        assert.equal(parseCommand({ text: '.' }, ['.']), null)
    })

    test('teks kosong ditolak', () => {
        assert.equal(parseCommand({ text: '' }, ['.']), null)
    })

    test('command di-lowercase', () => {
        assert.equal(parseCommand({ text: '.MENU' }, ['.']).command, 'menu')
    })

    test('prefix multi-karakter dipakai sesuai urutan config', () => {
        assert.deepEqual(parseCommand({ text: '#ping x' }, ['.', '#']), { prefix: '#', command: 'ping', args: ['x'], text: 'x' })
    })
})

describe('button response parsing', () => {
    test('id tanpa prefix', () => {
        assert.deepEqual(parseButtonResponse({ text: 'menu' }, ['.']), { prefix: '', command: 'menu', args: [], text: '' })
    })

    test('id dengan prefix', () => {
        assert.deepEqual(parseButtonResponse({ text: '.sc extra' }, ['.']), { prefix: '.', command: 'sc', args: ['extra'], text: 'extra' })
    })

    test('body kosong ditolak', () => {
        assert.equal(parseButtonResponse({ text: '' }, ['.']), null)
        assert.equal(parseButtonResponse({ text: '.' }, ['.']), null)
    })
})

describe('pattern plugin matching', () => {
    const patternHandlers = [
        { customPrefix: /^=>/ },
        { customPrefix: /loosekw/ }
    ]

    test('anchored pattern lebih diprioritaskan', () => {
        assert.equal(matchPatternPlugin({ text: '=> 1+1' }, patternHandlers), patternHandlers[0])
    })

    test('loose pattern dipakai jika tidak ada anchored', () => {
        assert.equal(matchPatternPlugin({ text: 'ada loosekw di sini' }, patternHandlers), patternHandlers[1])
    })

    test('tanpa kecocokan mengembalikan null', () => {
        assert.equal(matchPatternPlugin({ text: 'tidak ada' }, patternHandlers), null)
    })

    test('teks kosong mengembalikan null', () => {
        assert.equal(matchPatternPlugin({ text: '' }, patternHandlers), null)
    })
})

describe('dispatcher end-to-end', () => {
    test('command dengan prefix dieksekusi', async () => {
        const conn = makeConn()
        await handleMessage(conn, makeM('.e2eping'))
        assert.ok(conn.sent.some(s => s.content.text === 'pong'))
    })

    test('command tanpa prefix (single word) dieksekusi', async () => {
        const conn = makeConn()
        await handleMessage(conn, makeM('e2eping'))
        assert.ok(conn.sent.some(s => s.content.text === 'pong'))
    })

    test('command tidak dikenal tidak mengirim apa pun', async () => {
        const conn = makeConn()
        await handleMessage(conn, makeM('.tidakada'))
        assert.equal(conn.sent.length, 0)
    })

    test('multiword tanpa prefix jatuh ke loose pattern', async () => {
        const conn = makeConn()
        await handleMessage(conn, makeM('ini loosekw ya'))
        assert.ok(conn.sent.some(s => s.content.text === 'loose-hit'))
    })

    test('command dengan prefix tidak tertangkap loose pattern', async () => {
        const conn = makeConn()
        await handleMessage(conn, makeM('.e2eping loosekw'))
        assert.ok(conn.sent.some(s => s.content.text === 'pong'))
        assert.ok(!conn.sent.some(s => s.content.text === 'loose-hit'))
    })

    test('button response dieksekusi lewat alur yang sama', async () => {
        const conn = makeConn()
        await handleMessage(conn, makeM('.e2eping', { button: true }))
        assert.ok(conn.sent.some(s => s.content.text === 'pong'))
    })

    test('button response tanpa prefix dieksekusi', async () => {
        const conn = makeConn()
        await handleMessage(conn, makeM('e2eping', { button: true }))
        assert.ok(conn.sent.some(s => s.content.text === 'pong'))
    })

    test('plugin owner ditolak untuk user biasa', async () => {
        const conn = makeConn()
        await handleMessage(conn, makeM('.e2eowner'))
        assert.ok(!conn.sent.some(s => s.content.text === 'owner-ok'))
        assert.ok(conn.sent.some(s => s.content?.text?.includes('Khusus owner') || s.content?.text?.includes('owner')))
    })

    test('plugin owner diizinkan untuk bot sendiri (creator)', async () => {
        const conn = makeConn()
        await handleMessage(conn, makeM('.e2eowner', { sender: BOT_JID, chat: BOT_JID }))
        assert.ok(conn.sent.some(s => s.content.text === 'owner-ok'))
    })

    test('plugin owner diizinkan untuk owner terdaftar', async () => {
        const { owners } = await import('../src/services/access.js')
        owners.add('628333')
        try {
            const conn = makeConn()
            await handleMessage(conn, makeM('.e2eowner', { sender: '628333@s.whatsapp.net' }))
            assert.ok(conn.sent.some(s => s.content.text === 'owner-ok'))
        } finally {
            owners.remove('628333')
        }
    })

    test('plugin yang error tidak menghentikan pesan berikutnya', async () => {
        const conn = makeConn()
        await handleMessage(conn, makeM('.e2ethrow'))
        await handleMessage(conn, makeM('.e2eping'))
        assert.ok(conn.sent.some(s => s.content.text === 'pong'))
    })

    test('pesan duplikat diabaikan', async () => {
        const conn = makeConn()
        const id = crypto.randomUUID()
        await handleMessage(conn, makeM('.e2eping', { id }))
        await handleMessage(conn, makeM('.e2eping', { id }))
        assert.equal(conn.sent.filter(s => s.content.text === 'pong').length, 1)
    })

    test('pesan tanpa teks diabaikan', async () => {
        const conn = makeConn()
        await handleMessage(conn, makeM(''))
        assert.equal(conn.sent.length, 0)
    })

    test('anchored customPrefix mendapat text penuh', async () => {
        let received = null
        const file = 'test://capture'
        register(file, plugin(async (m) => {
            received = { text: m.text }
        }, { customPrefix: /^=/ }))

        try {
            const conn = makeConn()
            await handleMessage(conn, makeM('= hitung 1+1'))
            assert.deepEqual(received, { text: '= hitung 1+1' })
        } finally {
            unregisterPlugin(file, getKeysOf(file))
        }
    })

    test('identitas grup tidak menjadi user record', async () => {
        const conn = makeConn()
        await handleMessage(conn, makeM('.e2eping', { chat: '1203630299@g.us', sender: '628555@s.whatsapp.net' }))
        assert.ok(conn.sent.some(s => s.content.text === 'pong'))
        assert.equal(getUser('1203630299@g.us'), null, 'JID grup tidak boleh jadi user record')
    })

    test('limit habis memblokir plugin', async () => {
        const poor = upsertUser({ jid: '628444@s.whatsapp.net', name: 'Poor' })
        poor.limit = 0
        const { users } = await import('../src/services/database/json.js')
        users.set('628444', poor)

        const conn = makeConn()
        await handleMessage(conn, makeM('.e2elimit', { sender: '628444@s.whatsapp.net' }))
        assert.ok(!conn.sent.some(s => s.content.text === 'limit-ok'))
        assert.ok(conn.sent.some(s => s.content?.text?.includes('habis')))
    })

    test('limit cukup dieksekusi dan dikurangi', async () => {
        const rich = upsertUser({ jid: '628445@s.whatsapp.net', name: 'Rich' })
        rich.limit = 5
        const { users } = await import('../src/services/database/json.js')
        users.set('628445', rich)

        const conn = makeConn()
        await handleMessage(conn, makeM('.e2elimit', { sender: '628445@s.whatsapp.net' }))
        assert.ok(conn.sent.some(s => s.content.text === 'limit-ok'))
        assert.equal(getUser('628445@s.whatsapp.net').limit, 4)
    })

    test('mode self memblokir non-owner', async () => {
        updateConfig({ botMode: 'self' })
        try {
            const conn = makeConn()
            await handleMessage(conn, makeM('.e2eping'))
            assert.equal(conn.sent.length, 0)

            await handleMessage(conn, makeM('.e2eping', { fromMe: true }))
            assert.ok(conn.sent.some(s => s.content.text === 'pong'))
        } finally {
            updateConfig({ botMode: 'public' })
        }
        assert.equal(getConfig().botMode, 'public')
    })
})

describe('dispatcher LID end-to-end', () => {
    const OWNER_PN = '628333@s.whatsapp.net'
    const OWNER_LID = '111222333444555@lid'

    const bindMappingSocket = (stored = {}) => {
        const store = {
            calls: { getPN: 0, getLID: 0 },
            async getPNForLID(lid) {
                store.calls.getPN += 1
                const lidUser = String(lid).split('@')[0]
                for (const [pnUser, lidU] of Object.entries(stored)) {
                    if (lidU === lidUser) return `${pnUser}@s.whatsapp.net`
                }
                return null
            },
            async getLIDForPN(pn) {
                store.calls.getLID += 1
                const pnUser = String(pn).split('@')[0]
                return stored[pnUser] ? `${stored[pnUser]}@lid` : null
            },
            async storeLIDPNMappings() {}
        }
        setResolverSocket({ signalRepository: { lidMapping: store } })
        return store
    }

    test('pesan LID dengan mapping cocok dengan owner PN', async () => {
        const { owners } = await import('../src/services/access.js')
        owners.add('628333')
        try {
            bindMappingSocket({ '628333': '111222333444555' })

            const conn = makeConn()
            await handleMessage(conn, makeM('.e2eowner', { sender: OWNER_LID, chat: OWNER_LID }))

            assert.ok(conn.sent.some(s => s.content.text === 'owner-ok'), 'owner via LID dikenali lewat mapping ke PN')
        } finally {
            owners.remove('628333')
        }
    })

    test('pesan LID tanpa mapping tetap diproses sebagai identitas valid', async () => {
        bindMappingSocket({})

        const conn = makeConn()
        await handleMessage(conn, makeM('.e2eping', { sender: OWNER_LID, chat: OWNER_LID }))

        assert.ok(conn.sent.some(s => s.content.text === 'pong'))
        const record = getUser(OWNER_LID)
        assert.ok(record, 'user record dibuat dengan LID sebagai identitas')
        assert.equal(record.jid, OWNER_LID)
    })

    test('mapping otomatis tertangkap dari remoteJidAlt', async () => {
        const { owners } = await import('../src/services/access.js')
        owners.add('628333')
        try {
            bindMappingSocket({})

            const conn = makeConn()
            await handleMessage(conn, makeM('.e2eowner', {
                chat: OWNER_LID,
                sender: OWNER_LID,
                remoteJidAlt: OWNER_PN
            }))

            assert.ok(conn.sent.some(s => s.content.text === 'owner-ok'), 'pasangan LID-PN dari remoteJidAlt membuat owner dikenali')
        } finally {
            owners.remove('628333')
        }
    })

    test('mapping participant grup menautkan LID sender ke PN owner', async () => {
        const { owners } = await import('../src/services/access.js')
        owners.add('628333')
        try {
            bindMappingSocket({})
            const groupChat = '1203630299123456@g.us'

            const conn = makeConn()
            await handleMessage(conn, makeM('.e2eowner', {
                chat: groupChat,
                sender: OWNER_LID,
                participantAlt: OWNER_PN
            }))

            assert.ok(conn.sent.some(s => s.content.text === 'owner-ok'), 'participantAlt menautkan LID ke PN owner')
        } finally {
            owners.remove('628333')
        }
    })

    test('cooldown identitas sama untuk LID dan PN', async () => {
        bindMappingSocket({ '628222': '111222333444555' })

        const conn = makeConn()
        await handleMessage(conn, makeM('.e2ecooldown', { sender: OWNER_LID, chat: OWNER_LID }))
        assert.ok(conn.sent.some(s => s.content.text === 'cooldown-ok'))

        await handleMessage(conn, makeM('.e2ecooldown', { sender: USER_JID, chat: USER_JID }))
        assert.equal(conn.sent.filter(s => s.content.text === 'cooldown-ok').length, 1, 'pesan via PN dari user yang sama kena cooldown')
    })

    test('plugin gagal dieksekusi tidak meninggalkan cooldown', async () => {
        bindMappingSocket({})

        const conn = makeConn()
        await handleMessage(conn, makeM('.e2ethrowcooldown'))
        await handleMessage(conn, makeM('.e2ethrowcooldown'))

        const errors = conn.sent.length
        assert.ok(errors >= 0)
        assert.equal(conn.sent.filter(s => s.content?.text?.includes('Cooldown')).length, 0, 'tidak ada penolakan cooldown setelah kegagalan')
    })

    test('properti identitas tambahan tersedia untuk plugin', async () => {
        bindMappingSocket({ '628222': '111222333444555' })

        const conn = makeConn()
        await handleMessage(conn, makeM('.e2eidentity', { sender: OWNER_LID, chat: OWNER_LID }))

        const raw = conn.sent.find(s => s.content.text?.startsWith('{'))?.content.text
        assert.ok(raw, 'plugin menerima data identitas')
        const identity = JSON.parse(raw)

        assert.equal(identity.sender, OWNER_LID, 'm.sender tetap JID asli pesan')
        assert.equal(identity.senderPn, USER_JID)
        assert.equal(identity.senderLid, OWNER_LID)
        assert.equal(identity.identityNumber, '628222')
        assert.equal(identity.identityKey, '628222')
    })

    test('record user konvergen antara LID dan PN', async () => {
        bindMappingSocket({ '628222': '111222333444555' })

        const conn = makeConn()
        await handleMessage(conn, makeM('.e2eping', { sender: OWNER_LID, chat: OWNER_LID }))
        await handleMessage(conn, makeM('.e2eping', { sender: USER_JID, chat: USER_JID }))

        const record = getUser(USER_JID)
        assert.ok(record, 'record user memakai PN setelah mapping diketahui')
        assert.equal(record.jid, USER_JID)
    })

    test('group metadata participant dimanfaatkan untuk capture mapping', async () => {
        const { owners } = await import('../src/services/access.js')
        owners.add('628333')
        try {
            bindMappingSocket({})
            const groupChat = '1203630299887766@g.us'
            const conn = {
                ...makeConn(),
                groupMetadata: async () => ({
                    subject: 'Grup LID',
                    owner: '999888777666555@lid',
                    ownerPn: '628777111222@s.whatsapp.net',
                    participants: [
                        { id: OWNER_LID, lid: OWNER_LID, phoneNumber: OWNER_PN, admin: 'admin' }
                    ]
                })
            }

            await handleMessage(conn, makeM('.e2eping', { chat: groupChat, sender: OWNER_LID }))

            const { peekPNForLID } = await import('../src/services/identity-resolver.js')
            assert.equal(peekPNForLID(OWNER_LID), OWNER_PN, 'mapping tertangkap dari participant metadata grup')
            assert.equal(peekPNForLID('999888777666555@lid'), '628777111222@s.whatsapp.net', 'mapping owner grup juga tertangkap')

            await handleMessage(conn, makeM('.e2eowner', { chat: groupChat, sender: OWNER_LID }))
            assert.ok(conn.sent.some(s => s.content.text === 'owner-ok'))
        } finally {
            owners.remove('628333')
        }
    })

    test('pesan LID tanpa mapping tetap bisa perintah biasa dan user record terpisah', async () => {
        bindMappingSocket({})

        const conn = makeConn()
        const lonelyLid = '121212121212121@lid'
        await handleMessage(conn, makeM('.e2eping', { sender: lonelyLid, chat: lonelyLid }))

        assert.ok(conn.sent.some(s => s.content.text === 'pong'))
        assert.ok(getUser(lonelyLid), 'record LID-only dibuat dengan key LID')
        assert.equal(getUser(lonelyLid).jid, lonelyLid)
    })
})
