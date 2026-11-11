import { test, describe, beforeEach, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'

const tmpCv = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-cv-'))
process.env.WA_DATABASE_DIR = tmpCv
process.env.WA_OWNER_PATH = path.join(tmpCv, 'owner.json')
process.env.WA_PREMIUM_PATH = path.join(tmpCv, 'premium.json')
process.env.WA_CONFIG_PATH = path.join(tmpCv, 'config.json')
fs.writeFileSync(process.env.WA_CONFIG_PATH, JSON.stringify({ botMode: 'public', prefix: ['.'], dailyLimit: 5, creator: [] }))

const svc = await import('../src/services/whatsapp-service.js')
const conv = await import('../src/services/conversation-state.js')
const sched = await import('../src/services/scheduler.js')
const { flushAll } = await import('../src/services/database/json.js')

after(async () => {
    await sched.stopScheduler()
    flushAll()
    fs.rmSync(tmpCv, { recursive: true, force: true })
})

const makeConn = () => {
    const calls = { messages: [], presence: [], reads: [] }
    return {
        calls,
        sendMessage: async (jid, content, options) => {
            calls.messages.push({ jid, content, options })
            return { key: { id: `OUT${calls.messages.length}` } }
        },
        sendPresenceUpdate: async (type, toJid) => {
            calls.presence.push({ type, toJid })
        },
        readMessages: async keys => {
            calls.reads.push(keys)
        }
    }
}

const MESSAGE = {
    key: { remoteJid: '628111@s.whatsapp.net', fromMe: false, id: 'INMSG1' },
    message: { conversation: 'halo' }
}

describe('whatsapp service (API Baileys terverifikasi rc14)', () => {
    test('sendMessage validasi dan meneruskan konten', async () => {
        const conn = makeConn()
        await svc.sendMessage(conn, '628111@s.whatsapp.net', { text: 'hai' }, { quoted: MESSAGE })
        assert.deepEqual(conn.calls.messages[0], {
            jid: '628111@s.whatsapp.net',
            content: { text: 'hai' },
            options: { quoted: MESSAGE }
        })

        await assert.rejects(() => svc.sendMessage(null, 'x', { text: 'a' }), TypeError)
        await assert.rejects(() => svc.sendMessage(conn, '', { text: 'a' }), TypeError)
        await assert.rejects(() => svc.sendMessage(conn, '628111@s.whatsapp.net', 'bukan-object'), TypeError)
    })

    test('reply memakai quoted pesan', async () => {
        const conn = makeConn()
        await svc.replyMessage(conn, MESSAGE, { text: 'balasan' })
        assert.equal(conn.calls.messages[0].jid, '628111@s.whatsapp.net')
        assert.equal(conn.calls.messages[0].options.quoted, MESSAGE)
        await assert.rejects(() => svc.replyMessage(conn, {}, { text: 'x' }), TypeError)
    })

    test('react memakai key pesan; string kosong menghapus reaksi', async () => {
        const conn = makeConn()
        await svc.reactToMessage(conn, MESSAGE, '👍')
        assert.deepEqual(conn.calls.messages[0].content, {
            react: { text: '👍', key: MESSAGE.key }
        })

        await svc.reactToMessage(conn, MESSAGE)
        assert.deepEqual(conn.calls.messages[1].content, {
            react: { text: '', key: MESSAGE.key }
        })
    })

    test('edit dan delete memakai key.remoteJid', async () => {
        const conn = makeConn()
        const key = { remoteJid: '628222@s.whatsapp.net', fromMe: true, id: 'MSG9' }

        await svc.editMessage(conn, key, 'teks baru')
        assert.deepEqual(conn.calls.messages[0], {
            jid: '628222@s.whatsapp.net',
            content: { text: 'teks baru', edit: key },
            options: undefined
        })

        await svc.deleteForEveryone(conn, key)
        assert.deepEqual(conn.calls.messages[1].content, { delete: key })

        await assert.rejects(() => svc.editMessage(conn, {}, 'x'), TypeError)
        await assert.rejects(() => svc.deleteForEveryone(conn, null), TypeError)
    })

    test('forward mengirim konten forward dari key+message', async () => {
        const conn = makeConn()
        await svc.forwardMessage(conn, '628333@s.whatsapp.net', MESSAGE, { force: true })
        assert.deepEqual(conn.calls.messages[0].content, {
            forward: { key: MESSAGE.key, message: MESSAGE.message },
            force: true
        })
        await assert.rejects(() => svc.forwardMessage(conn, '628333@s.whatsapp.net', { key: MESSAGE.key }), TypeError)
    })

    test('presence tervalidasi dan typing berakhir paused', async () => {
        mock.timers.enable({ apis: ['setTimeout'] })
        try {
            const conn = makeConn()
            await svc.setPresence(conn, 'composing', '628111@s.whatsapp.net')
            assert.deepEqual(conn.calls.presence[0], { type: 'composing', toJid: '628111@s.whatsapp.net' })
            await assert.rejects(() => svc.setPresence(conn, 'menari', 'x'), TypeError)

            const cancel = await svc.sendTyping(conn, '628111@s.whatsapp.net', { duration: 1000 })
            assert.deepEqual(conn.calls.presence.at(-1), { type: 'composing', toJid: '628111@s.whatsapp.net' })

            mock.timers.tick(1000)
            await flush()

            assert.deepEqual(conn.calls.presence.at(-1), { type: 'paused', toJid: '628111@s.whatsapp.net' })

            const cancel2 = await svc.sendTyping(conn, '628111@s.whatsapp.net', { duration: 5000 })
            await cancel2()
            await flush()
            assert.deepEqual(conn.calls.presence.at(-1), { type: 'paused', toJid: '628111@s.whatsapp.net' })
            assert.ok(cancel || cancel2)
        } finally {
            mock.timers.reset()
        }
    })

    test('markRead meneruskan array keys', async () => {
        const conn = makeConn()
        await svc.markRead(conn, [MESSAGE.key])
        assert.deepEqual(conn.calls.reads[0], [MESSAGE.key])
        await assert.rejects(() => svc.markRead(conn, []), TypeError)
    })

    const flush = () => new Promise(resolve => setImmediate(resolve))
})

describe('conversation state', () => {
    beforeEach(() => conv.resetConversationState())

    test('set/get/clear dengan TTL default', () => {
        conv.setConversationState('628111@s.whatsapp.net', 'flow', { step: 1 })
        assert.deepEqual(conv.getConversationState('628111@s.whatsapp.net', 'flow'), { step: 1 })

        assert.equal(conv.clearConversationState('628111@s.whatsapp.net', 'flow'), true)
        assert.equal(conv.getConversationState('628111@s.whatsapp.net', 'flow'), null)
    })

    test('kedaluwarsa TTL mengembalikan null dan menyapu', () => {
        mock.timers.enable({ apis: ['Date'] })
        try {
            conv.setConversationState('chat-a', 'flow', 'v', 1000)
            assert.equal(conv.getConversationState('chat-a', 'flow'), 'v')

            mock.timers.tick(1500)
            assert.equal(conv.getConversationState('chat-a', 'flow'), null)
            assert.equal(conv.sweepExpiredStates(), 0, 'sudah dibuang saat akses')
        } finally {
            mock.timers.reset()
        }
    })

    test('sweepExpiredStates membersihkan entri kedaluwarsa', () => {
        mock.timers.enable({ apis: ['Date'] })
        try {
            conv.setConversationState('chat-b', 'a', 1, 500)
            conv.setConversationState('chat-b', 'b', 2, 60_000)
            mock.timers.tick(1000)

            assert.equal(conv.sweepExpiredStates(), 1)
            assert.equal(conv.getConversationState('chat-b', 'b'), 2)
        } finally {
            mock.timers.reset()
        }
    })

    test('clearChatStates membersihkan semua state satu chat', () => {
        conv.setConversationState('chat-c', 'a', 1)
        conv.setConversationState('chat-c', 'b', 2)
        conv.setConversationState('chat-d', 'a', 3)

        assert.equal(conv.clearChatStates('chat-c'), 2)
        assert.equal(conv.getConversationState('chat-c', 'a'), null)
        assert.equal(conv.getConversationState('chat-d', 'a'), 3)
    })

    test('input tidak valid ditolak dan kapasitas terbatas', () => {
        assert.throws(() => conv.setConversationState('', 'x', 1), TypeError)
        assert.throws(() => conv.setConversationState('chat', '', 1), TypeError)
        assert.throws(() => conv.setConversationState('chat', 'x', 1, 0), TypeError)

        for (let i = 0; i < 1050; i++) {
            conv.setConversationState('chat-e', `k${i}`, i)
        }
        assert.ok(conv.getConversationStats().entries <= conv.getConversationStats().max)
    })
})

describe('scheduler pesan WhatsApp', () => {
    beforeEach(async () => {
        await sched.stopScheduler()
        sched.resetSchedulerState()
    })

    const flush = () => new Promise(resolve => setImmediate(resolve))

    test('job one-time terjadwal lewat waktu dieksekusi sekali lalu dihapus', async () => {
        mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
        try {
            const conn = makeConn()
            await sched.startScheduler({
                sender: async (chatJid, content) => {
                    await conn.sendMessage(chatJid, content)
                }
            })

            sched.addScheduledJob({
                id: 'remind-1',
                chatJid: '628111@s.whatsapp.net',
                content: { text: 'ingat!' },
                at: Date.now() - 10
            })

            mock.timers.tick(31_000)
            await flush()
            await flush()

            assert.equal(conn.calls.messages.length, 1)
            assert.deepEqual(conn.calls.messages[0].content, { text: 'ingat!' })
            assert.equal(sched.listScheduledJobs().length, 0, 'job one-time dihapus setelah jalan')
        } finally {
            mock.timers.reset()
            await sched.stopScheduler()
        }
    })

    test('job interval berulang tanpa tumpang tindih', async () => {
        mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
        try {
            const conn = makeConn()
            let release
            const gate = new Promise(resolve => { release = resolve })

            await sched.startScheduler({
                sender: async (chatJid, content) => {
                    await conn.sendMessage(chatJid, content)
                    await gate
                }
            })

            sched.addScheduledJob({
                id: 'tick-every',
                chatJid: '628222@s.whatsapp.net',
                content: { text: 'ulang' },
                every: 20_000
            })

            mock.timers.tick(31_000)
            await flush()
            assert.equal(conn.calls.messages.length, 1, 'eksekusi pertama berjalan')

            mock.timers.tick(31_000)
            await flush()
            assert.equal(conn.calls.messages.length, 1, 'eksekusi saat masih berjalan tidak diduplikasi')

            release()
            await flush()
            await flush()
            assert.equal(sched.listScheduledJobs().length, 1, 'job interval tetap ada')
        } finally {
            mock.timers.reset()
            await sched.stopScheduler()
        }
    })

    test('job one-time gagal dicoba ulang lalu dibuang setelah batas', async () => {
        mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
        try {
            const errors = []
            const realConsoleError = console.error
            console.error = (...args) => errors.push(args.join(' '))

            let attempts = 0
            await sched.startScheduler({
                sender: async () => {
                    attempts += 1
                    throw new Error('gagal kirim')
                }
            })

            sched.addScheduledJob({
                id: 'poison',
                chatJid: '628333@s.whatsapp.net',
                content: { text: 'coba' },
                at: Date.now() - 5
            })

            for (let i = 0; i < 4; i++) {
                mock.timers.tick(31_000)
                await flush()
                await flush()
            }

            assert.ok(attempts >= 2, 'dicoba ulang minimal sekali')
            assert.equal(sched.listScheduledJobs().length, 0, 'dibuang setelah batas percobaan')
            assert.ok(errors.length >= 1, 'kegagalan dilaporkan')
            console.error = realConsoleError
        } finally {
            mock.timers.reset()
            await sched.stopScheduler()
        }
    })

    test('job tersimpan di disk dan dipulihkan saat start ulang', async () => {
        const { flushAll: flushNow } = await import('../src/services/database/json.js')

        await sched.startScheduler({ sender: async () => {} })
        sched.addScheduledJob({
            id: 'persisted',
            chatJid: '628444@s.whatsapp.net',
            content: { text: 'tetap ada' },
            at: Date.now() + 60_000
        })
        flushNow()
        await sched.stopScheduler()

        const fresh = await import('../src/services/scheduler.js?restore=1')
        await fresh.startScheduler({ sender: async () => {} })

        const restored = fresh.listScheduledJobs().find(job => job.id === 'persisted')
        assert.ok(restored, 'job dipulihkan dari persistensi')
        assert.deepEqual(restored.content, { text: 'tetap ada' })

        await fresh.stopScheduler()
        await sched.startScheduler({ sender: async () => {} })
        await sched.stopScheduler()
    })

    test('cancel mencegah eksekusi', async () => {
        mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
        try {
            const conn = makeConn()
            await sched.startScheduler({
                sender: async (chatJid, content) => {
                    await conn.sendMessage(chatJid, content)
                }
            })

            sched.addScheduledJob({
                id: 'cancelled',
                chatJid: '628555@s.whatsapp.net',
                content: { text: 'tidak jalan' },
                at: Date.now() - 1
            })

            assert.equal(sched.cancelScheduledJob('cancelled'), true)
            mock.timers.tick(31_000)
            await flush()

            assert.equal(conn.calls.messages.length, 0)
        } finally {
            mock.timers.reset()
            await sched.stopScheduler()
        }
    })

    test('input tidak valid ditolak', async () => {
        assert.throws(() => sched.addScheduledJob({ id: '', chatJid: 'x', content: {} }), TypeError)
        assert.throws(() => sched.addScheduledJob({ id: 'x', chatJid: '', content: {} }), TypeError)
        assert.throws(() => sched.addScheduledJob({ id: 'x', chatJid: 'y', content: 'str' }), TypeError)
        assert.throws(() => sched.addScheduledJob({ id: 'x', chatJid: 'y', content: {} }), TypeError, 'tanpa at/every')
        assert.throws(() => sched.addScheduledJob({ id: 'x', chatJid: 'y', content: {}, every: 500 }), TypeError)
    })
})
