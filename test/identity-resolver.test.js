import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'
import { fileURLToPath, pathToFileURL } from 'url'

const tmpRes = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-res-'))
process.env.WA_DATABASE_DIR = tmpRes
process.env.WA_CONFIG_PATH = path.join(tmpRes, 'config.json')
fs.writeFileSync(process.env.WA_CONFIG_PATH, JSON.stringify({ dailyLimit: 5, botMode: 'public', prefix: ['.'] }))

const {
    setResolverSocket,
    resetResolverState,
    storeIdentityMapping,
    resolvePN,
    resolveLID,
    resolveIdentity,
    getIdentityJids,
    peekPNForLID,
    peekLIDForPN,
    captureFromMessage,
    captureFromContacts,
    captureFromGroupMetadata,
    resolveSenderIdentity,
    getResolverStats
} = await import('../src/services/identity-resolver.js')
const { flushAll } = await import('../src/services/database/json.js')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const resolverPath = path.resolve(__dirname, '../src/services/identity-resolver.js')

const PN_A = '628111222333@s.whatsapp.net'
const LID_A = '555444333222111@lid'
const PN_B = '628999888777@s.whatsapp.net'
const LID_B = '777888999000111@lid'

const makeMappingStore = (initial = {}) => {
    const stored = new Map(Object.entries(initial))
    const calls = { getPN: 0, getLID: 0, store: 0 }

    const userOf = jid => String(jid).split('@')[0].split(':')[0]

    return {
        calls,
        stored,
        async getPNForLID(lid) {
            calls.getPN += 1
            for (const [pnUser, lidUser] of stored) {
                if (lidUser === userOf(lid)) return `${pnUser}@s.whatsapp.net`
            }
            return null
        },
        async getLIDForPN(pn) {
            calls.getLID += 1
            const lidUser = stored.get(userOf(pn))
            return lidUser ? `${lidUser}@lid` : null
        },
        async storeLIDPNMappings(pairs) {
            calls.store += 1
            for (const { lid, pn } of pairs) {
                if (!lid || !pn) continue
                stored.set(userOf(pn), userOf(lid))
            }
        }
    }
}

const makeSocket = store => ({ signalRepository: { lidMapping: store } })

const runNode = script => new Promise((resolve, reject) => {
    execFile(
        process.execPath,
        ['--input-type=module', '-e', script],
        { cwd: path.resolve(__dirname, '..'), env: process.env },
        (error, stdout, stderr) => {
            if (error) reject(new Error(`${error.message}\n${stderr}`))
            else resolve(stdout.trim())
        }
    )
})

before(() => {
    resetResolverState()
})

after(() => {
    setResolverSocket(null)
    flushAll()
    fs.rmSync(tmpRes, { recursive: true, force: true })
})

describe('automatic capture dari pesan', () => {
    beforeEach(() => {
        resetResolverState()
    })

    test('remoteJid LID + remoteJidAlt PN tersimpan', async () => {
        setResolverSocket(makeSocket(makeMappingStore()))
        await captureFromMessage({
            remoteJid: LID_A,
            remoteJidAlt: PN_A
        })

        assert.equal(peekPNForLID(LID_A), PN_A)
        assert.equal(peekLIDForPN(PN_A), LID_A)
    })

    test('remoteJid PN + remoteJidAlt LID tersimpan (urutan bebas)', async () => {
        setResolverSocket(makeSocket(makeMappingStore()))
        await captureFromMessage({
            remoteJid: PN_A,
            remoteJidAlt: LID_A
        })

        assert.equal(peekPNForLID(LID_A), PN_A)
    })

    test('participant LID + participantAlt PN tersimpan', async () => {
        setResolverSocket(makeSocket(makeMappingStore()))
        await captureFromMessage({
            remoteJid: '1203630299123456@g.us',
            participant: LID_A,
            participantAlt: PN_A
        })

        assert.equal(peekPNForLID(LID_A), PN_A)
        assert.equal(peekLIDForPN(PN_A), LID_A)
    })

    test('senderPn dipakai jika tersedia', async () => {
        setResolverSocket(makeSocket(makeMappingStore()))
        await captureFromMessage({
            remoteJid: LID_A,
            senderPn: PN_A
        })

        assert.equal(peekPNForLID(LID_A), PN_A)
    })

    test('device suffix dinormalisasi saat capture', async () => {
        setResolverSocket(makeSocket(makeMappingStore()))
        await captureFromMessage({
            remoteJid: `${LID_A.split('@')[0]}:0@lid`,
            remoteJidAlt: `${PN_A.split('@')[0]}:2@s.whatsapp.net`
        })

        assert.equal(peekPNForLID(LID_A), PN_A)
        assert.equal(peekLIDForPN(PN_A), LID_A)
    })

    test('alternate JID tidak ada tidak membuat mapping palsu', async () => {
        setResolverSocket(makeSocket(makeMappingStore()))
        await captureFromMessage({ remoteJid: LID_A })
        await captureFromMessage({ remoteJid: PN_A })
        await captureFromMessage({ participant: LID_B })

        assert.equal(peekPNForLID(LID_A), null)
        assert.equal(peekLIDForPN(PN_A), null)
        assert.equal(peekPNForLID(LID_B), null)
    })

    test('pasangan identitas invalid ditolak', async () => {
        const store = makeMappingStore()
        setResolverSocket(makeSocket(store))
        await captureFromMessage({ remoteJid: PN_A, remoteJidAlt: PN_B })
        await captureFromMessage({ remoteJid: LID_A, remoteJidAlt: LID_B })
        await captureFromMessage({ remoteJid: '1203630299123456@g.us', remoteJidAlt: PN_A })
        await captureFromMessage({ remoteJid: 'status@broadcast', remoteJidAlt: PN_A })
        await captureFromMessage({ remoteJid: '1234@newsletter', remoteJidAlt: LID_A })

        assert.equal(store.calls.store, 0, 'tidak ada mapping yang dikirim ke Baileys')
        assert.equal(getResolverStats().pnCount, 0)
    })

    test('key null tidak membuat error', async () => {
        await captureFromMessage(null)
        await captureFromMessage({})
    })

    test('capture duplikat tidak menulis berulang', async () => {
        const store = makeMappingStore()
        setResolverSocket(makeSocket(store))

        await captureFromMessage({ remoteJid: LID_A, remoteJidAlt: PN_A })
        const storesAfterFirst = store.calls.store

        await captureFromMessage({ remoteJid: LID_A, remoteJidAlt: PN_A })
        await captureFromMessage({ participant: LID_A, participantAlt: PN_A })

        assert.equal(store.calls.store, storesAfterFirst, 'mapping identik tidak dikirim lagi')
    })

    test('mapping bertentangan dari sumber terverifikasi mengganti yang lama', async () => {
        const store = makeMappingStore()
        setResolverSocket(makeSocket(store))

        await storeIdentityMapping(LID_A, PN_A)
        await storeIdentityMapping(LID_B, PN_A)

        assert.equal(peekPNForLID(LID_A), null, 'reverse mapping lama dibersihkan')
        assert.equal(peekPNForLID(LID_B), PN_A)
        assert.equal(peekLIDForPN(PN_A), LID_B)
    })

    test('storeIdentityMapping menerima urutan terbalik', async () => {
        resetResolverState()
        setResolverSocket(makeSocket(makeMappingStore()))
        const stored = await storeIdentityMapping(PN_A, LID_A)

        assert.equal(stored, true)
        assert.equal(peekPNForLID(LID_A), PN_A)
    })
})

describe('capture dari kontak dan grup', () => {
    beforeEach(() => {
        resetResolverState()
    })

    test('contact id PN + lid tersimpan', async () => {
        setResolverSocket(makeSocket(makeMappingStore()))
        await captureFromContacts([
            { id: PN_A, lid: LID_A, name: 'Kontak A' }
        ])

        assert.equal(peekLIDForPN(PN_A), LID_A)
    })

    test('contact lid + phoneNumber tersimpan', async () => {
        setResolverSocket(makeSocket(makeMappingStore()))
        await captureFromContacts([
            { id: LID_A, lid: LID_A, phoneNumber: PN_A }
        ])

        assert.equal(peekPNForLID(LID_A), PN_A)
    })

    test('contact tanpa pasangan LID-PN diabaikan', async () => {
        const store = makeMappingStore()
        setResolverSocket(makeSocket(store))
        await captureFromContacts([
            { id: PN_A, name: 'hanya pn' },
            { id: LID_A, lid: LID_A },
            { id: PN_A, phoneNumber: PN_B }
        ])

        assert.equal(store.calls.store, 0)
        assert.equal(getResolverStats().pnCount, 0)
    })

    test('contact list invalid tidak membuat error', async () => {
        await captureFromContacts(null)
        await captureFromContacts('bukan-array')
        await captureFromContacts([null, undefined, 42])
    })

    test('group participant mapping tersimpan', async () => {
        setResolverSocket(makeSocket(makeMappingStore()))
        await captureFromGroupMetadata({
            id: '1203630299123456@g.us',
            subject: 'Grup Uji',
            participants: [
                { id: LID_A, phoneNumber: PN_A, admin: 'admin' },
                { id: LID_B, lid: LID_B, phoneNumber: PN_B }
            ]
        })

        assert.equal(peekPNForLID(LID_A), PN_A)
        assert.equal(peekPNForLID(LID_B), PN_B)
    })

    test('group owner dan author mapping tersimpan', async () => {
        setResolverSocket(makeSocket(makeMappingStore()))
        await captureFromGroupMetadata({
            id: '1203630299123456@g.us',
            owner: LID_A,
            ownerPn: PN_A,
            author: LID_B,
            authorPn: PN_B
        })

        assert.equal(peekPNForLID(LID_A), PN_A)
        assert.equal(peekPNForLID(LID_B), PN_B)
    })

    test('metadata null tidak membuat error', async () => {
        await captureFromGroupMetadata(null)
        await captureFromGroupMetadata({})
    })
})

describe('lookup perilaku', () => {
    beforeEach(() => {
        resetResolverState()
    })

    test('resolvePN menemukan PN dari LID lewat Baileys lalu cache lokal', async () => {
        const store = makeMappingStore({ '628111222333': '555444333222111' })
        setResolverSocket(makeSocket(store))

        const pn = await resolvePN(LID_A)
        assert.equal(pn, PN_A)
        assert.equal(store.calls.getPN, 1)

        setResolverSocket(null)
        const cached = await resolvePN(LID_A)
        assert.equal(cached, PN_A, 'mapping tersimpan di cache lokal setelah lookup Baileys')
    })

    test('resolveLID menemukan LID dari PN lewat Baileys lalu cache lokal', async () => {
        const store = makeMappingStore({ '628111222333': '555444333222111' })
        setResolverSocket(makeSocket(store))

        const lid = await resolveLID(PN_A)
        assert.equal(lid, LID_A)

        setResolverSocket(null)
        const cached = await resolveLID(PN_A)
        assert.equal(cached, LID_A)
    })

    test('mapping tidak dikenal mengembalikan null tanpa data palsu', async () => {
        const store = makeMappingStore()
        setResolverSocket(makeSocket(store))

        assert.equal(await resolvePN(LID_A), null)
        assert.equal(await resolveLID(PN_A), null)
    })

    test('negative cache mencegah lookup berulang ke Baileys', async () => {
        const store = makeMappingStore()
        setResolverSocket(makeSocket(store))

        await resolvePN(LID_A)
        await resolvePN(LID_A)
        await resolvePN(LID_A)

        assert.equal(store.calls.getPN, 1, 'hanya satu lookup Baileys untuk LID yang sama')

        await resolveLID(PN_A)
        await resolveLID(PN_A)
        assert.equal(store.calls.getLID, 1)
    })

    test('negative cache dibersihkan setelah mapping diketahui', async () => {
        const store = makeMappingStore()
        setResolverSocket(makeSocket(store))

        await resolvePN(LID_A)
        assert.equal(store.calls.getPN, 1)

        await captureFromMessage({ remoteJid: LID_A, remoteJidAlt: PN_A })

        const pn = await resolvePN(LID_A)
        assert.equal(pn, PN_A)
    })

    test('input invalid mengembalikan null', async () => {
        setResolverSocket(makeSocket(makeMappingStore()))

        assert.equal(await resolvePN('1203630299123456@g.us'), null)
        assert.equal(await resolvePN('status@broadcast'), null)
        assert.equal(await resolvePN(PN_A), null, 'PN bukan input resolvePN')
        assert.equal(await resolvePN(null), null)
        assert.equal(await resolveLID(LID_A), null, 'LID bukan input resolveLID')
        assert.equal(await resolveLID('1203630299123456@g.us'), null)
    })

    test('lookup bersamaan untuk identitas sama hanya sekali ke Baileys', async () => {
        let pending = 0
        let maxPending = 0
        const store = makeMappingStore({ '628111222333': '555444333222111' })
        store.getPNForLID = async lid => {
            pending += 1
            maxPending = Math.max(maxPending, pending)
            await new Promise(r => setTimeout(r, 20))
            pending -= 1
            return PN_A
        }
        setResolverSocket(makeSocket(store))

        const results = await Promise.all([
            resolvePN(LID_A),
            resolvePN(LID_A),
            resolvePN(LID_A),
            resolvePN(`${LID_A.split('@')[0]}:0@lid`)
        ])

        assert.deepEqual(results, [PN_A, PN_A, PN_A, PN_A])
        assert.equal(store.calls.getPN + 1 <= 2, true, 'lookup tidak boleh berlipat ganda')
    })

    test('error dari Baileys tidak menggagalkan handler', async () => {
        const store = makeMappingStore()
        store.getPNForLID = async () => { throw new Error('usync down') }
        store.getLIDForPN = async () => { throw new Error('usync down') }
        store.storeLIDPNMappings = async () => { throw new Error('store down') }
        setResolverSocket(makeSocket(store))

        assert.equal(await resolvePN(LID_A), null)
        assert.equal(await resolveLID(PN_A), null)

        await captureFromMessage({ remoteJid: LID_A, remoteJidAlt: PN_A })
        assert.equal(peekPNForLID(LID_A), PN_A, 'mapping tetap tersimpan lokal')
    })

    test('resolveIdentity mengembalikan pasangan lengkap dua arah', async () => {
        setResolverSocket(makeSocket(makeMappingStore()))
        await storeIdentityMapping(LID_A, PN_A)

        assert.deepEqual(await resolveIdentity(PN_A), { pn: PN_A, lid: LID_A })
        assert.deepEqual(await resolveIdentity(LID_A), { pn: PN_A, lid: LID_A })
        assert.deepEqual(await resolveIdentity('1203630299123456@g.us'), { pn: null, lid: null })
    })

    test('getIdentityJids mengembalikan semua JID pengguna yang sama', async () => {
        setResolverSocket(makeSocket(makeMappingStore()))
        await storeIdentityMapping(LID_A, PN_A)

        assert.deepEqual(await getIdentityJids(PN_A), [PN_A, LID_A])
        assert.deepEqual(await getIdentityJids(LID_A), [PN_A, LID_A])
        assert.deepEqual(await getIdentityJids('1203630299123456@g.us'), [])
    })
})

describe('resolveSenderIdentity untuk pesan', () => {
    beforeEach(() => {
        resetResolverState()
    })

    test('pesan grup: sender LID dipasangkan dengan PN', async () => {
        setResolverSocket(makeSocket(makeMappingStore()))
        const m = {
            key: {
                remoteJid: '1203630299123456@g.us',
                participant: LID_A,
                participantAlt: PN_A
            },
            sender: LID_A
        }

        await captureFromMessage(m.key)
        const identity = await resolveSenderIdentity(m)

        assert.equal(identity.pn, PN_A)
        assert.equal(identity.lid, LID_A)
        assert.equal(identity.number, '628111222333')
        assert.deepEqual(identity.jids, [LID_A, PN_A])
    })

    test('pesan pribadi LID: hanya LID bila mapping tidak ada', async () => {
        setResolverSocket(makeSocket(makeMappingStore()))
        const m = {
            key: { remoteJid: LID_A },
            sender: LID_A
        }

        const identity = await resolveSenderIdentity(m)

        assert.equal(identity.pn, null, 'tidak ada nomor telepon palsu')
        assert.equal(identity.lid, LID_A)
        assert.equal(identity.number, null)
        assert.deepEqual(identity.jids, [LID_A])
    })

    test('JID grup tidak pernah jadi identitas pengirim', async () => {
        setResolverSocket(makeSocket(makeMappingStore()))
        const m = {
            key: { remoteJid: '1203630299123456@g.us' },
            sender: '1203630299123456@g.us'
        }

        const identity = await resolveSenderIdentity(m)
        assert.deepEqual(identity.jids, [])
        assert.equal(identity.pn, null)
        assert.equal(identity.number, null)
    })

    test('pesan dari PN mengembalikan nomor langsung', async () => {
        setResolverSocket(makeSocket(makeMappingStore()))
        const m = {
            key: { remoteJid: PN_A },
            sender: PN_A
        }

        const identity = await resolveSenderIdentity(m)
        assert.equal(identity.pn, PN_A)
        assert.equal(identity.number, '628111222333')
    })
})

describe('persistence mapping', () => {
    beforeEach(() => {
        resetResolverState()
    })

    test('mapping tersimpan ke database lokal', async () => {
        setResolverSocket(makeSocket(makeMappingStore()))
        await storeIdentityMapping(LID_A, PN_A)
        flushAll()

        const raw = JSON.parse(fs.readFileSync(path.join(tmpRes, 'identity.json'), 'utf8'))
        assert.equal(raw['628111222333'], '555444333222111')
    })

    test('mapping tetap bisa dipakai setelah restart (proses baru)', async () => {
        setResolverSocket(makeSocket(makeMappingStore()))
        await captureFromMessage({ remoteJid: LID_A, remoteJidAlt: PN_A })
        flushAll()
        setResolverSocket(null)

        const script = `
            const { setResolverSocket, resolvePN, resolveLID, peekPNForLID } = await import(${JSON.stringify(pathToFileURL(resolverPath).href)})
            setResolverSocket({ signalRepository: { lidMapping: { getPNForLID: async () => null, getLIDForPN: async () => null } } })
            const pn = await resolvePN(${JSON.stringify(LID_A)})
            const lid = await resolveLID(${JSON.stringify(PN_A)})
            console.log(JSON.stringify({ pn, lid }))
        `

        const output = await runNode(script)
        assert.deepEqual(JSON.parse(output), { pn: PN_A, lid: LID_A })
    })

    test('Baileys tetap sumber utama saat cache lokal kosong', async () => {
        resetResolverState()
        flushAll()

        const script = `
            const { setResolverSocket, resolvePN, getResolverStats } = await import(${JSON.stringify(pathToFileURL(resolverPath).href)})
            const store = {
                getPNForLID: async () => ${JSON.stringify(PN_B)},
                getLIDForPN: async () => null,
                storeLIDPNMappings: async () => {}
            }
            setResolverSocket({ signalRepository: { lidMapping: store } })
            const pn = await resolvePN(${JSON.stringify(LID_B)})
            const stats = getResolverStats()
            console.log(JSON.stringify({ pn, cached: stats.pnCount }))
        `

        const output = await runNode(script)
        const parsed = JSON.parse(output)
        assert.equal(parsed.pn, PN_B)
        assert.equal(parsed.cached, 1, 'hasil lookup Baileys masuk cache lokal')
    })

    test('cache dibatasi agar tidak tumbuh tanpa batas', async () => {
        const store = makeMappingStore()
        setResolverSocket(makeSocket(store))

        for (let i = 0; i < 10200; i++) {
            await storeIdentityMapping(`${100000000000000 + i}@lid`, `${628000000000 + i}@s.whatsapp.net`)
        }

        const stats = getResolverStats()
        assert.ok(stats.pnCount <= 10000, `ukuran cache ${stats.pnCount} harus dibatasi`)
        assert.ok(stats.lidCount <= 10000)
    })
})
