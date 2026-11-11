import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'

const tmpSec = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-sec-'))
process.env.WA_DATABASE_DIR = tmpSec
process.env.WA_OWNER_PATH = path.join(tmpSec, 'owner.json')
process.env.WA_PREMIUM_PATH = path.join(tmpSec, 'premium.json')

const { isPersonalJid, toNumber, toUserJid, toLidJid, getConfiguredNumbers, normalizePersonalJid } = await import('../src/utils/identity.js')
const { owners, premiums } = await import('../src/services/access.js')
const { upsertUser } = await import('../src/services/database/users.js')

after(() => {
    fs.rmSync(tmpSec, { recursive: true, force: true })
})

describe('validasi JID', () => {
    test('isPersonalJid', () => {
        assert.equal(isPersonalJid('628123@s.whatsapp.net'), true)
        assert.equal(isPersonalJid('998877@lid'), true)
        assert.equal(isPersonalJid('998877@hosted.lid'), true)
        assert.equal(isPersonalJid('998877@hosted'), true)
        assert.equal(isPersonalJid('12036302@g.us'), false)
        assert.equal(isPersonalJid('status@broadcast'), false)
        assert.equal(isPersonalJid('12345@newsletter'), false)
        assert.equal(isPersonalJid(''), false)
        assert.equal(isPersonalJid(null), false)
    })

    test('toNumber hanya menerima identifier personal berbasis PN', () => {
        assert.equal(toNumber('628123@s.whatsapp.net'), '628123')
        assert.equal(toNumber('628123:2@s.whatsapp.net'), '628123', 'device dibuang')
        assert.equal(toNumber('+62 812-3456-789'), '628123456789')
        assert.equal(toNumber('628123'), '628123')
    })

    test('toNumber menolak identifier non-personal dan LID', () => {
        assert.equal(toNumber('628123@lid'), null, 'LID bukan nomor telepon')
        assert.equal(toNumber('12036302@g.us'), null, 'grup bukan user')
        assert.equal(toNumber('status@broadcast'), null)
        assert.equal(toNumber('12345@newsletter'), null)
        assert.equal(toNumber('abc'), null)
        assert.equal(toNumber(''), null)
        assert.equal(toNumber(null), null)
    })

    test('toUserJid mengembalikan JID PN yang valid', () => {
        assert.equal(toUserJid('628123@s.whatsapp.net'), '628123@s.whatsapp.net')
        assert.equal(toUserJid('628123'), '628123@s.whatsapp.net')
        assert.equal(toUserJid('12036302@g.us'), null)
        assert.equal(toUserJid('998877@lid'), null, 'LID tidak dipaksa jadi PN')
        assert.equal(toUserJid(''), null)
    })

    test('toLidJid mengembalikan JID LID yang valid', () => {
        assert.equal(toLidJid('998877@lid'), '998877@lid')
        assert.equal(toLidJid('628123@s.whatsapp.net'), null)
        assert.equal(toLidJid('12036302@g.us'), null)
        assert.equal(toLidJid(null), null)
    })

    test('normalizePersonalJid mempertahankan tipe JID', () => {
        assert.equal(normalizePersonalJid('628123:2@s.whatsapp.net'), '628123@s.whatsapp.net')
        assert.equal(normalizePersonalJid('998877:3@lid'), '998877@lid')
        assert.equal(normalizePersonalJid('12036302@g.us'), null)
        assert.equal(normalizePersonalJid('status@broadcast'), null)
    })

    test('getConfiguredNumbers memfilter input non-personal', () => {
        assert.deepEqual(
            getConfiguredNumbers(['628123', '628124@s.whatsapp.net', '12036302@g.us', '998877@lid', 'abc']),
            ['628123', '628124']
        )
    })
})

describe('access list service', () => {
    test('add dan has bekerja', () => {
        assert.equal(owners.add('628888'), true)
        assert.equal(owners.has('628888@s.whatsapp.net'), true)
        assert.equal(owners.has('628777@s.whatsapp.net'), false)
        assert.equal(owners.has('628888@lid'), false, 'LID adalah ruang id berbeda, tidak cocok dengan list PN')
    })

    test('add duplikat tidak menambah dua kali', () => {
        assert.equal(owners.add('628888'), false)
        assert.equal(owners.all().filter(e => String(e).startsWith('628888')).length, 1)
    })

    test('perubahan tersimpan ke file', () => {
        const raw = JSON.parse(fs.readFileSync(process.env.WA_OWNER_PATH, 'utf8'))
        assert.ok(raw.includes('628888@s.whatsapp.net'))
    })

    test('remove menghapus dan mengembalikan false untuk yang tidak ada', () => {
        assert.equal(owners.remove('628888'), true)
        assert.equal(owners.has('628888@s.whatsapp.net'), false)
        assert.equal(owners.remove('628888'), false)
    })

    test('add menolak nomor tidak valid', () => {
        assert.throws(() => owners.add('abc'), TypeError)
        assert.throws(() => owners.add(''), TypeError)
    })

    test('premium list terpisah dari owner list', () => {
        premiums.add('628666')
        assert.equal(premiums.has('628666@s.whatsapp.net'), true)
        assert.equal(owners.has('628666@s.whatsapp.net'), false)
        premiums.remove('628666')
    })
})

describe('user record isolation', () => {
    test('upsertUser menolak record dari JID grup', () => {
        assert.equal(upsertUser({ jid: '12036302@g.us', name: 'bukan-user' }), null)
    })

    test('upsertUser menolak record dari broadcast', () => {
        assert.equal(upsertUser({ jid: 'status@broadcast', name: 'bukan-user' }), null)
    })
})
