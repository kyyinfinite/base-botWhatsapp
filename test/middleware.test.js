import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'

const tmpMid = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-mid-'))
process.env.WA_DATABASE_DIR = tmpMid
process.env.WA_OWNER_PATH = path.join(tmpMid, 'owner.json')
process.env.WA_PREMIUM_PATH = path.join(tmpMid, 'premium.json')
process.env.WA_CONFIG_PATH = path.join(tmpMid, 'config.json')
fs.writeFileSync(process.env.WA_CONFIG_PATH, JSON.stringify({ dailyLimit: 5, botMode: 'public', prefix: ['.'], accessDenied: { owner: 'Khusus owner.' } }))

const { runMiddleware, useMiddleware, getMiddlewares } = await import('../src/core/middleware/engine.js')
const { clearCooldowns, checkCooldown, commitCooldown, releaseCooldown, getCooldownKey } = await import('../src/core/middleware/cooldown.js')
const { upsertUser, getUser } = await import('../src/services/database/users.js')
const { flushAll } = await import('../src/services/database/json.js')

const makeCtx = (overrides = {}) => {
    const sent = []
    return {
        sent,
        conn: { sendMessage: async (jid, content, opts) => { sent.push({ jid, content, opts }); return {} } },
        m: { chat: '628100@s.whatsapp.net', userJid: '628100@s.whatsapp.net', key: { remoteJid: '628100@s.whatsapp.net' } },
        chat: '628100@s.whatsapp.net',
        sender: '628100@s.whatsapp.net',
        command: 'test',
        isOwner: false,
        isCreator: false,
        isPremium: false,
        isGroup: false,
        isAdmin: false,
        isBotAdmin: false,
        accessDenied: { owner: 'Khusus owner.' },
        notifReply: async (text, title) => {
            sent.push({ text, title })
            return {}
        },
        user: { limit: 5 },
        ...overrides
    }
}

const makeHandler = (meta = {}) => {
    const handler = async () => {}
    Object.assign(handler, meta)
    return handler
}

after(() => {
    flushAll()
    fs.rmSync(tmpMid, { recursive: true, force: true })
})

describe('middleware engine', () => {
    beforeEach(() => {
        clearCooldowns()
    })

    test('middleware bawaan terdaftar dengan urutan yang benar', () => {
        const list = getMiddlewares()
        assert.ok(list.length >= 9)
        const names = list.map(fn => fn.name)
        assert.equal(names[0], 'ownerMiddleware')
        assert.equal(names.at(-2), 'cooldownMiddleware')
        assert.equal(names.at(-1), 'limitMiddleware')
    })

    test('plugin tanpa restriction selalu diizinkan', async () => {
        const ctx = makeCtx()
        const result = await runMiddleware(ctx, makeHandler({}))
        assert.deepEqual(result, { allowed: true })
        assert.equal(ctx.sent.length, 0)
    })

    test('owner middleware menolak non-owner', async () => {
        const ctx = makeCtx()
        const result = await runMiddleware(ctx, makeHandler({ owner: true }))
        assert.equal(result.allowed, false)
        assert.equal(result.message, 'Khusus owner.')
        assert.equal(ctx.sent.length, 1)
        assert.equal(ctx.sent[0].title, 'Access Denied')
    })

    test('owner middleware mengizinkan owner tanpa kirim pesan', async () => {
        const ctx = makeCtx({ isOwner: true })
        const result = await runMiddleware(ctx, makeHandler({ owner: true }))
        assert.deepEqual(result, { allowed: true })
        assert.equal(ctx.sent.length, 0)
    })

    test('group middleware menolak di luar grup', async () => {
        const ctx = makeCtx()
        const result = await runMiddleware(ctx, makeHandler({ group: true }))
        assert.equal(result.allowed, false)
    })

    test('private middleware menolak di dalam grup', async () => {
        const ctx = makeCtx({ isGroup: true, chat: '1203@g.us' })
        const result = await runMiddleware(ctx, makeHandler({ private: true }))
        assert.equal(result.allowed, false)
    })

    test('premium middleware mengizinkan flag premium (dispatcher menurunkan owner ke premium)', async () => {
        const ctx = makeCtx({ isPremium: true })
        const result = await runMiddleware(ctx, makeHandler({ premium: true }))
        assert.deepEqual(result, { allowed: true })
    })

    test('cooldown memblokir pemakaian kedua', async () => {
        const handler = makeHandler({ cooldown: 5000 })
        const first = await runMiddleware(makeCtx(), handler)
        assert.deepEqual(first, { allowed: true })

        const second = await runMiddleware(makeCtx(), handler)
        assert.equal(second.allowed, false)
        assert.match(second.message, /Tunggu \d+ detik/)
    })

    test('cooldown aktif dihitung dari sisa waktu', () => {
        const key = 'user:chat:cmd'
        commitCooldown(key, 60_000)
        const state = checkCooldown(key)

        assert.equal(state.active, true)
        assert.ok(state.remainingMs > 50_000 && state.remainingMs <= 60_000)
        clearCooldowns()
    })

    test('cooldown kedaluwarsa tidak memblokir', async () => {
        const handler = makeHandler({ cooldown: 30 })
        const ctx = makeCtx()
        const first = await runMiddleware(ctx, handler)
        assert.deepEqual(first, { allowed: true })

        await new Promise(r => setTimeout(r, 60))

        const second = await runMiddleware(makeCtx(), handler)
        assert.deepEqual(second, { allowed: true })
    })

    test('entry kedaluwarsa dibersihkan dari memori', async () => {
        const key = 'u:c:expired'
        commitCooldown(key, 10)
        await new Promise(r => setTimeout(r, 30))

        checkCooldown('trigger-sweep')
        assert.equal(checkCooldown(key).active, false)

        releaseCooldown('trigger-sweep')
        releaseCooldown(key)
    })

    test('cooldown dilepas saat plugin gagal dieksekusi', async () => {
        const handler = makeHandler({ cooldown: 60_000 })
        const ctx = makeCtx()
        const result = await runMiddleware(ctx, handler)
        assert.deepEqual(result, { allowed: true })

        assert.equal(typeof ctx._cooldownRelease, 'function')
        ctx._cooldownRelease()

        const retry = await runMiddleware(makeCtx(), handler)
        assert.deepEqual(retry, { allowed: true }, 'tidak ada cooldown permanen setelah kegagalan')
    })

    test('cooldown key sama untuk identitas LID dan PN pengguna yang sama', async () => {
        const pnCtx = makeCtx({
            sender: '555444333222111@lid',
            identityKey: '628111222333',
            chat: '628100@s.whatsapp.net'
        })
        const lidCtx = makeCtx({
            sender: '628111222333@s.whatsapp.net',
            identityKey: '628111222333',
            chat: '628100@s.whatsapp.net'
        })

        const handler = makeHandler({ cooldown: 5000, command: 'same' })
        pnCtx.command = 'same'
        lidCtx.command = 'same'

        const keyPn = getCooldownKey(pnCtx, handler)
        const keyLid = getCooldownKey(lidCtx, handler)
        assert.equal(keyPn, keyLid)

        const first = await runMiddleware(pnCtx, handler)
        assert.deepEqual(first, { allowed: true })

        const second = await runMiddleware(lidCtx, handler)
        assert.equal(second.allowed, false, 'pesan via PN dan LID dari user yang sama kena cooldown sama')
    })

    test('cooldown key terpisah untuk chat berbeda', () => {
        const handler = makeHandler({ command: 'x' })
        const a = makeCtx({ chat: '628100@s.whatsapp.net', identityKey: '6281' })
        const b = makeCtx({ chat: '628200@s.whatsapp.net', identityKey: '6281' })
        a.command = 'x'
        b.command = 'x'

        assert.notEqual(getCooldownKey(a, handler), getCooldownKey(b, handler))
    })

    test('eksekusi bersamaan command yang sama hanya satu lolos', async () => {
        const handler = makeHandler({ cooldown: 5000 })
        const results = await Promise.all([
            runMiddleware(makeCtx(), handler),
            runMiddleware(makeCtx(), handler),
            runMiddleware(makeCtx(), handler)
        ])

        const allowed = results.filter(r => r.allowed === true).length
        const denied = results.filter(r => r.allowed === false).length
        assert.equal(allowed, 1)
        assert.equal(denied, 2)
    })

    test('cooldown tidak berlaku untuk plugin tanpa cooldown', async () => {
        const result = await runMiddleware(makeCtx(), makeHandler({}))
        assert.deepEqual(result, { allowed: true })
    })

    test('cooldown antara command dan button response berbagi perilaku', async () => {
        const handler = makeHandler({ cooldown: 5000 })
        const commandCtx = makeCtx()
        const buttonCtx = makeCtx({ command: 'test' })
        buttonCtx.m = { ...buttonCtx.m, isButtonResponse: true }

        const first = await runMiddleware(commandCtx, handler)
        assert.deepEqual(first, { allowed: true })

        const second = await runMiddleware(buttonCtx, handler)
        assert.equal(second.allowed, false)
    })

    test('limit memblokir ketika limit tidak cukup', async () => {
        const ctx = makeCtx({ user: { limit: 1 } })
        const result = await runMiddleware(ctx, makeHandler({ limit: 3 }))
        assert.equal(result.allowed, false)
        assert.equal(ctx._limitRefund, undefined)
    })

    test('limit di-reserve atomik saat middleware lolos dan bisa di-refund', async () => {
        upsertUser({ jid: '628100@s.whatsapp.net', name: 'Tester' })
        const ctx = makeCtx({ user: { limit: 5 } })
        const result = await runMiddleware(ctx, makeHandler({ limit: 2 }))
        assert.deepEqual(result, { allowed: true })

        const record = upsertUser({ jid: '628100@s.whatsapp.net', name: 'Tester' })
        assert.equal(record.limit, 3, 'limit langsung dikurangi saat reserve')
        assert.equal(typeof ctx._limitRefund, 'function')

        ctx._limitRefund()
        const refunded = upsertUser({ jid: '628100@s.whatsapp.net', name: 'Tester' })
        assert.equal(refunded.limit, 5, 'refund mengembalikan reserve')
    })

    test('reserve atomik: dua eksekusi paralel chat berbeda dengan limit 1 hanya satu lolos', async () => {
        const { users } = await import('../src/services/database/json.js')
        const record = upsertUser({ jid: '628103@s.whatsapp.net', name: 'Racer' })
        record.limit = 1
        users.set('628103', record)

        const makeRacer = () => makeCtx({
            m: { chat: '628103@s.whatsapp.net', userJid: '628103@s.whatsapp.net', key: { remoteJid: '628103@s.whatsapp.net' } },
            chat: '628103@s.whatsapp.net',
            sender: '628103@s.whatsapp.net'
        })

        const [a, b] = await Promise.all([
            runMiddleware(makeRacer(), makeHandler({ limit: 1 })),
            runMiddleware(makeRacer(), makeHandler({ limit: 1 }))
        ])

        assert.equal([a, b].filter(r => r.allowed).length, 1, 'hanya satu reserve berhasil')
        assert.equal(getUser('628103@s.whatsapp.net').limit, 0, 'saldo tidak minus')
    })

    test('user tanpa record diblokir dan tidak dibuat oleh middleware', async () => {
        const ctx = makeCtx({
            m: { chat: '628104@s.whatsapp.net', userJid: '628104@s.whatsapp.net', key: { remoteJid: '628104@s.whatsapp.net' } },
            chat: '628104@s.whatsapp.net',
            sender: '628104@s.whatsapp.net'
        })
        const result = await runMiddleware(ctx, makeHandler({ limit: 1 }))
        assert.equal(result.allowed, false)
        assert.equal(getUser('628104@s.whatsapp.net'), null)
    })

    test('limit tidak berlaku untuk owner', async () => {
        const ctx = makeCtx({ isOwner: true, user: { limit: 0 } })
        const result = await runMiddleware(ctx, makeHandler({ limit: 2 }))
        assert.deepEqual(result, { allowed: true })
    })

    test('useMiddleware menambahkan middleware kustom', async () => {
        const calls = []
        const dispose = useMiddleware(async (ctx, handler) => {
            calls.push('custom')
            if (handler.blockedByCustom) return { allowed: false, title: 'Custom', message: 'Diblokir custom.' }
            return null
        })

        try {
            const ctx1 = makeCtx()
            const result1 = await runMiddleware(ctx1, makeHandler({ blockedByCustom: true }))
            assert.equal(result1.allowed, false)
            assert.equal(ctx1.sent[0].title, 'Custom')

            const result2 = await runMiddleware(makeCtx(), makeHandler({}))
            assert.deepEqual(result2, { allowed: true })
            assert.deepEqual(calls, ['custom', 'custom'])
        } finally {
            dispose()
        }
    })

    test('middleware kustom yang melempar error bersifat fail-closed', async () => {
        const dispose = useMiddleware(async () => {
            throw new Error('middleware bug')
        })

        try {
            const ctx = makeCtx()
            const result = await runMiddleware(ctx, makeHandler({}))
            assert.equal(result.allowed, false)
            assert.equal(ctx.sent.length, 1)
        } finally {
            dispose()
        }
    })

    test('dispose menghapus middleware kustom', async () => {
        const count = getMiddlewares().length
        const dispose = useMiddleware(async () => null)
        assert.equal(getMiddlewares().length, count + 1)
        dispose()
        assert.equal(getMiddlewares().length, count)
    })

    test('useMiddleware menolak non-fungsi', () => {
        assert.throws(() => useMiddleware('bukan-fungsi'), TypeError)
    })

    test('result true memutus rantai sebagai diizinkan', async () => {
        let afterCalled = false
        const dispose = useMiddleware(async () => true)
        const dispose2 = useMiddleware(async () => {
            afterCalled = true
            return { allowed: false, message: 'seharusnya tidak dipanggil' }
        })

        try {
            const result = await runMiddleware(makeCtx(), makeHandler({}))
            assert.deepEqual(result, { allowed: true })
            assert.equal(afterCalled, false, 'middleware setelah result true tidak boleh jalan')
        } finally {
            dispose()
            dispose2()
        }
    })

    test('middleware kustom berjalan setelah middleware bawaan', async () => {
        const order = []
        const dispose = useMiddleware(async () => {
            order.push('custom')
            return null
        })

        try {
            await runMiddleware(makeCtx(), makeHandler({ owner: true }))
            assert.deepEqual(order, [], 'custom tidak boleh jalan jika bawaan sudah menolak')

            await runMiddleware(makeCtx(), makeHandler({}))
            assert.deepEqual(order, ['custom'])
        } finally {
            dispose()
        }
    })
})
