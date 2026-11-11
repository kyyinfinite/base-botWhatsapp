import { test, describe, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'

const tmpGc = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-gc-'))
process.env.WA_DATABASE_DIR = tmpGc
process.env.WA_OWNER_PATH = path.join(tmpGc, 'owner.json')
process.env.WA_PREMIUM_PATH = path.join(tmpGc, 'premium.json')
process.env.WA_CONFIG_PATH = path.join(tmpGc, 'config.json')
fs.writeFileSync(process.env.WA_CONFIG_PATH, JSON.stringify({ botMode: 'public', prefix: ['.'], dailyLimit: 5, creator: [] }))

const {
    getCachedGroupMetadata,
    captureGroupMetadata,
    invalidateGroupMetadata,
    setGroupCacheSocket,
    resetGroupCache,
    getGroupCacheStats
} = await import('../src/services/group-cache.js')
const { getAdminState } = await import('../src/core/middleware/admin.js')

const META = {
    id: '120363000@g.us',
    subject: 'Grup Cache',
    participants: [
        { id: '628111@s.whatsapp.net', admin: 'admin' },
        { id: '628000@s.whatsapp.net' }
    ]
}

const makeConn = (metadata, counter) => ({
    groupMetadata: async () => {
        counter.calls += 1
        if (typeof metadata === 'function') return metadata()
        return metadata
    },
    decodeJid: jid => jid,
    user: { id: '628000@s.whatsapp.net' }
})

describe('group metadata cache', () => {
    beforeEach(() => {
        resetGroupCache()
        setGroupCacheSocket(null)
    })

    test('fetch sekali, panggilan berikutnya dari cache', async () => {
        const counter = { calls: 0 }
        const conn = makeConn(META, counter)
        setGroupCacheSocket(conn)

        const a = await getCachedGroupMetadata('120363000@g.us')
        const b = await getCachedGroupMetadata('120363000@g.us')

        assert.equal(counter.calls, 1)
        assert.equal(a.subject, 'Grup Cache')
        assert.deepEqual(b.participants, META.participants)
    })

    test('hasil cache adalah clone, mutasi penerima tidak merusak cache', async () => {
        const conn = makeConn(META, { calls: 0 })
        setGroupCacheSocket(conn)

        const a = await getCachedGroupMetadata('120363000@g.us')
        a.subject = 'dirusak'
        a.participants.length = 0

        const b = await getCachedGroupMetadata('120363000@g.us')
        assert.equal(b.subject, 'Grup Cache')
        assert.equal(b.participants.length, 2)
    })

    test('invalidate memaksa fetch ulang', async () => {
        const counter = { calls: 0 }
        let subject = 'Awal'
        const conn = makeConn(() => ({ ...META, subject }), counter)
        setGroupCacheSocket(conn)

        await getCachedGroupMetadata('120363001@g.us')
        assert.equal(counter.calls, 1)

        invalidateGroupMetadata('120363001@g.us')
        subject = 'Baru'
        const fresh = await getCachedGroupMetadata('120363001@g.us')
        assert.equal(counter.calls, 2)
        assert.equal(fresh.subject, 'Baru')
    })

    test('captureGroupMetadata menyajikan metadata tanpa fetch', async () => {
        const counter = { calls: 0 }
        const conn = makeConn(META, counter)
        setGroupCacheSocket(conn)

        captureGroupMetadata({ ...META, subject: 'Dari Event' }, '120363002@g.us')
        const served = await getCachedGroupMetadata('120363002@g.us')
        assert.equal(served.subject, 'Dari Event')
        assert.equal(counter.calls, 0)
    })

    test('TTL kedaluwarsa memicu fetch ulang', async () => {
        mock.timers.enable({ apis: ['Date'] })
        try {
            const counter = { calls: 0 }
            const conn = makeConn(META, counter)
            setGroupCacheSocket(conn)

            await getCachedGroupMetadata('120363003@g.us')
            await getCachedGroupMetadata('120363003@g.us')
            assert.equal(counter.calls, 1)

            mock.timers.tick(5 * 60_000 + 1)
            await getCachedGroupMetadata('120363003@g.us')
            assert.equal(counter.calls, 2)
        } finally {
            mock.timers.reset()
        }
    })

    test('kegagalan fetch tidak di-cache dan mengembalikan undefined', async () => {
        const conn = { groupMetadata: async () => { throw new Error('offline') } }
        setGroupCacheSocket(conn)

        const result = await getCachedGroupMetadata('120363005@g.us')
        assert.equal(result, undefined)
        assert.equal(getGroupCacheStats().entries, 0)
    })

    test('batas entri dijaga, entri terlama terbuang', async () => {
        const counter = { calls: 0 }
        const conn = makeConn(META, counter)
        setGroupCacheSocket(conn)

        const keyOf = i => `1209990000${String(i).padStart(3, '0')}@g.us`
        for (let i = 0; i <= 500; i++) {
            await getCachedGroupMetadata(keyOf(i))
        }

        assert.equal(getGroupCacheStats().entries <= 500, true)

        const before = counter.calls
        await getCachedGroupMetadata(keyOf(500))
        assert.equal(counter.calls, before, 'entri terbaru masih ter-cache')

        await getCachedGroupMetadata(keyOf(0))
        assert.equal(counter.calls, before + 1, 'entri terlama sudah terbuang')
    })

    test('admin middleware memakai cache metadata', async () => {
        const counter = { calls: 0 }
        const conn = makeConn(META, counter)
        setGroupCacheSocket(conn)

        const mkCtx = () => ({
            isGroup: true,
            chat: '120363004@g.us',
            sender: '628111@s.whatsapp.net',
            conn,
            m: {},
            group: {}
        })

        const first = await getAdminState(mkCtx())
        assert.deepEqual(first, { isAdmin: true, isBotAdmin: false })

        const second = await getAdminState(mkCtx())
        assert.deepEqual(second, { isAdmin: true, isBotAdmin: false })

        assert.equal(counter.calls, 1, 'metadata hanya di-fetch sekali untuk dua eksekusi')
    })

    test('tanpa socket dan tanpa conn, metadata tidak tersedia', async () => {
        const result = await getCachedGroupMetadata('120363006@g.us')
        assert.equal(result, undefined)
    })
})
