import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'

const tmpDb = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-db-'))
const tmpConfig = path.join(tmpDb, 'config.json')
fs.writeFileSync(tmpConfig, JSON.stringify({ dailyLimit: 7, botMode: 'public', prefix: ['.'] }))

process.env.WA_DATABASE_DIR = tmpDb
process.env.WA_CONFIG_PATH = tmpConfig

const db = await import('../src/services/database/json.js')
const { users, groups, settings, identityMappings, flushAll, flushDirty } = db
const { getUserKey, getUser, upsertUser, consumeUserLimit, resetAllUserLimits } = await import('../src/services/database/users.js')
const { getGroup, getGroupKey, upsertGroup } = await import('../src/services/database/groups.js')
const { getDailyLimit, updateConfig, getConfig } = await import('../src/services/config.js')

const usersFile = path.join(tmpDb, 'users.json')
const settingsFile = path.join(tmpDb, 'settings.json')

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'))

after(() => {
    flushAll()
    fs.rmSync(tmpDb, { recursive: true, force: true })
})

describe('json database', () => {
    test('collection set/get/touch/delete bekerja', () => {
        settings.set('k1', { a: 1 })
        assert.deepEqual(settings.get('k1'), { a: 1 })

        settings.touch('k1', { b: 2 })
        assert.deepEqual(settings.get('k1'), { a: 1, b: 2 })

        settings.delete('k1')
        assert.equal(settings.get('k1'), null)
    })

    test('set ter-persist setelah flush deterministik', async () => {
        users.set('persist-user', { limit: 5 })
        await flushDirty()

        assert.equal(readJson(usersFile)['persist-user'].limit, 5)
        users.delete('persist-user')
        await flushDirty()
    })

    test('touch ter-persist lewat mekanisme yang sama dengan set', async () => {
        users.set('touch-user', { limit: 5 })
        await flushDirty()

        users.touch('touch-user', { lastSeen: 'now' })
        await flushDirty()

        const raw = readJson(usersFile)['touch-user']
        assert.equal(raw.limit, 5)
        assert.equal(raw.lastSeen, 'now')

        users.touch('touch-user', { lastSeen: 'later' })
        await flushDirty()
        assert.equal(readJson(usersFile)['touch-user'].lastSeen, 'later')

        users.delete('touch-user')
        await flushDirty()
    })

    test('touch tanpa set sebelumnya juga ter-persist', async () => {
        settings.touch('touch-only', { seen: 1 })
        await flushDirty()

        assert.equal(readJson(settingsFile)['touch-only'].seen, 1)
        settings.delete('touch-only')
        await flushDirty()
    })

    test('delete ter-persist setelah flush', async () => {
        users.set('del-user', { limit: 1 })
        await flushDirty()
        assert.ok(readJson(usersFile)['del-user'])

        users.delete('del-user')
        await flushDirty()
        assert.equal(readJson(usersFile)['del-user'], undefined)
    })

    test('flushAll menuliskan seluruh perubahan tertunda', () => {
        users.set('flush-user', { limit: 5 })
        flushAll()
        assert.equal(readJson(usersFile)['flush-user'].limit, 5)
        users.delete('flush-user')
        flushAll()
    })

    test('gagal tulis mempertahankan dirty state untuk retry', async () => {
        const originalWrite = fs.writeFileSync
        let failures = 0

        users.set('retry-user', { limit: 9 })

        fs.writeFileSync = () => {
            failures += 1
            throw new Error('disk penuh')
        }

        await flushDirty()
        assert.ok(failures >= 1, 'writeSync harus gagal')
        assert.equal(readJson(usersFile)['retry-user'], undefined, 'file belum berubah')

        fs.writeFileSync = originalWrite
        await flushDirty()

        assert.equal(readJson(usersFile)['retry-user'].limit, 9)
        users.delete('retry-user')
        await flushDirty()
    })

    test('perubahan berdekatan tidak hilang saat flush', async () => {
        users.set('burst-a', { n: 1 })
        users.set('burst-b', { n: 2 })
        users.touch('burst-a', { extra: true })
        users.delete('burst-b')
        await flushDirty()

        const raw = readJson(usersFile)
        assert.equal(raw['burst-a'].n, 1)
        assert.equal(raw['burst-a'].extra, true)
        assert.equal(raw['burst-b'], undefined)

        users.delete('burst-a')
        await flushDirty()
    })

    test('update bersamaan tidak saling menimpa', async () => {
        users.set('conc-user', { hits: 0 })

        const bumps = Array.from({ length: 10 }, (_, i) =>
            new Promise(resolve => setTimeout(() => {
                const current = users.get('conc-user') || { hits: 0 }
                users.set('conc-user', { hits: current.hits + 1, tag: i })
                resolve()
            }, i))
        )

        await Promise.all(bumps)
        await flushDirty()

        const raw = readJson(usersFile)['conc-user']
        assert.equal(raw.hits, 10, 'semua increment harus tercatat')
        users.delete('conc-user')
        await flushDirty()
    })

    test('flushDirty bersamaan tidak menulis ganda atau bentrok', async () => {
        users.set('par-user', { n: 1 })

        const flushes = await Promise.all([
            flushDirty(),
            flushDirty(),
            flushDirty()
        ])

        assert.equal(users.get('par-user').n, 1)
        assert.equal(readJson(usersFile)['par-user'].n, 1)

        users.delete('par-user')
        await flushDirty()
    })

    test('shutdown flush menyimpan data touch terakhir', () => {
        settings.set('shutdown-key', { a: 1 })
        settings.touch('shutdown-key', { final: true })
        flushAll()

        const raw = readJson(settingsFile)['shutdown-key']
        assert.equal(raw.a, 1)
        assert.equal(raw.final, true)

        settings.delete('shutdown-key')
        flushAll()
    })

    test('flushAll kedua setelah data bersih tidak menulis apa pun', () => {
        flushAll()
        const before = fs.statSync(settingsFile).mtimeMs
        flushAll()
        assert.equal(fs.statSync(settingsFile).mtimeMs, before)
    })
})

describe('user database', () => {
    test('getUserKey menolak JID non-personal', () => {
        assert.equal(getUserKey('123456@g.us'), null)
        assert.equal(getUserKey('status@broadcast'), null)
        assert.equal(getUserKey('12345@newsletter'), null)
        assert.equal(getUserKey(''), null)
        assert.equal(getUserKey(null), null)
    })

    test('getUserKey menerima JID personal dengan namespace terjaga', () => {
        assert.equal(getUserKey('628123@s.whatsapp.net'), '628123')
        assert.equal(getUserKey('628123'), '628123')
        assert.equal(getUserKey('628123:2@s.whatsapp.net'), '628123')
        assert.equal(getUserKey('628123@lid'), '628123@lid', 'LID tidak boleh jadi nomor telepon')
    })

    test('upsertUser membuat record baru dengan limit dari config', () => {
        const record = upsertUser({ jid: '628111@s.whatsapp.net', name: 'Andi' })
        assert.equal(record.limit, 7)
        assert.equal(record.name, 'Andi')
        assert.equal(record.premium, false)
    })

    test('upsertUser menjaga firstSeen dan limit yang sudah ada', () => {
        const first = upsertUser({ jid: '628112@s.whatsapp.net', name: 'Budi' })
        first.limit = 3
        users.set(getUserKey('628112@s.whatsapp.net'), first)

        const second = upsertUser({ jid: '628112@s.whatsapp.net', name: 'Budi' })
        assert.equal(second.firstSeen, first.firstSeen)
        assert.equal(second.limit, 3)
    })

    test('upsertUser menolak JID grup', () => {
        assert.equal(upsertUser({ jid: '1203@g.us', name: 'Grup' }), null)
    })

    test('upsertUser pada LID membuat record terpisah dari PN', () => {
        const lidRecord = upsertUser({ jid: '987654321098765@lid', name: 'Lid User' })
        assert.equal(lidRecord.jid, '987654321098765@lid')
        assert.equal(getUserKey('987654321098765@lid'), '987654321098765@lid')
        assert.equal(getUser('987654321098765@lid').name, 'Lid User')
    })

    test('consumeUserLimit mengurangi limit tanpa negatif', () => {
        upsertUser({ jid: '628113@s.whatsapp.net', name: 'Cici' })
        const after1 = consumeUserLimit('628113@s.whatsapp.net', 2)
        assert.equal(after1.limit, 5)

        const after2 = consumeUserLimit('628113@s.whatsapp.net', 99)
        assert.equal(after2.limit, 0)
    })

    test('consumeUserLimit pada user yang belum terdaftar mengembalikan null', () => {
        assert.equal(consumeUserLimit('628999@s.whatsapp.net', 1), null)
    })

    test('resetAllUserLimits mengembalikan semua limit', () => {
        const count = resetAllUserLimits(7)
        assert.ok(count >= 3)
        assert.equal(getUser('628113@s.whatsapp.net').limit, 7)
    })
})

describe('group database', () => {
    test('getGroupKey hanya menerima JID grup', () => {
        assert.equal(getGroupKey('123@g.us'), '123@g.us')
        assert.equal(getGroupKey('123@s.whatsapp.net'), null)
    })

    test('upsertGroup membuat dan memperbarui record', () => {
        const created = upsertGroup({ jid: '111@g.us', name: 'Grup Satu' })
        assert.equal(created.name, 'Grup Satu')

        const updated = upsertGroup({ jid: '111@g.us', name: 'Grup Baru' })
        assert.equal(updated.name, 'Grup Baru')
        assert.equal(updated.createdAt, created.createdAt)
        assert.equal(getGroup('111@g.us').jid, '111@g.us')
    })
})

describe('identity mapping collection', () => {
    test('identityMappings persist pasangan pn-lid', async () => {
        identityMappings.set('628111', '111222333444555')
        await flushDirty()

        assert.equal(readJson(path.join(tmpDb, 'identity.json'))['628111'], '111222333444555')
        identityMappings.delete('628111')
        await flushDirty()
    })
})

describe('config service', () => {
    test('getConfig membaca config', () => {
        assert.equal(getConfig().dailyLimit, 7)
        assert.equal(getDailyLimit(), 7)
    })

    test('getDailyLimit fallback ke 10 jika tidak valid', () => {
        updateConfig({ dailyLimit: null })
        assert.equal(getDailyLimit(), 10)
        updateConfig({ dailyLimit: 7 })
    })

    test('updateConfig menulis patch ke disk dan cache konsisten', () => {
        updateConfig({ botName: 'Uji Bot' })
        const raw = JSON.parse(fs.readFileSync(tmpConfig, 'utf8'))
        assert.equal(raw.botName, 'Uji Bot')
        assert.equal(getConfig().botName, 'Uji Bot')
        updateConfig({ botName: 'kyyinfinite' })
    })

    test('updateConfig menolak patch non-object', () => {
        assert.throws(() => updateConfig('bukan-object'), TypeError)
        assert.throws(() => updateConfig([1, 2]), TypeError)
    })
})
