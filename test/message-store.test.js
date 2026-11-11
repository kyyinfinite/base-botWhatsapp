import { test, describe, beforeEach, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'

const tmpMs = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-ms-'))
process.env.WA_DATABASE_DIR = tmpMs
process.env.WA_OWNER_PATH = path.join(tmpMs, 'owner.json')
process.env.WA_PREMIUM_PATH = path.join(tmpMs, 'premium.json')
process.env.WA_CONFIG_PATH = path.join(tmpMs, 'config.json')
fs.writeFileSync(process.env.WA_CONFIG_PATH, JSON.stringify({ botMode: 'public', prefix: ['.'], dailyLimit: 5, creator: [] }))

const { storeOutgoingMessage, getMessageForRetry, getMessageStoreStats, resetMessageStore } =
    await import('../src/services/message-store.js')
const { flushAll } = await import('../src/services/database/json.js')

const storeFile = path.join(tmpMs, 'messages.json')

const CONTENT = { conversation: 'halo dari bot' }

after(() => {
    flushAll()
    fs.rmSync(tmpMs, { recursive: true, force: true })
})

describe('message store (F-6)', () => {
    beforeEach(() => {
        resetMessageStore()
    })

    test('pesan terkirim tersimpan dan diambil untuk retry', () => {
        const key = { remoteJid: '628111@s.whatsapp.net', fromMe: true, id: 'MSG1' }
        assert.equal(storeOutgoingMessage(key, CONTENT), true)
        assert.deepEqual(getMessageForRetry({ ...key, id: 'MSG1' }), CONTENT)
    })

    test('pesan non-own dan konten tidak valid ditolak', () => {
        assert.equal(storeOutgoingMessage({ id: 'MSG2' }, null), false)
        assert.equal(storeOutgoingMessage(null, CONTENT), false)
        assert.equal(getMessageForRetry({ id: 'missing' }), undefined)
        assert.equal(getMessageForRetry({}), undefined)
    })

    test('store ter-persist ke disk dan dapat dimuat ulang', async () => {
        storeOutgoingMessage({ remoteJid: '628112@s.whatsapp.net', id: 'MSG3' }, CONTENT)
        flushAll()

        const raw = JSON.parse(fs.readFileSync(storeFile, 'utf8'))
        assert.equal(raw['MSG3'].content.conversation, 'halo dari bot')

        const fresh = await import('../src/services/message-store.js?reload=1')
        assert.deepEqual(fresh.getMessageForRetry({ id: 'MSG3' }), CONTENT, 'record dimuat ulang oleh instance baru')
    })

    test('LRU: entri terlama dibuang saat melebihi kapasitas', () => {
        const { max } = getMessageStoreStats()
        for (let i = 0; i <= max; i++) {
            storeOutgoingMessage({ remoteJid: '628113@s.whatsapp.net', id: `BULK${i}` }, { conversation: String(i) })
        }

        assert.equal(getMessageStoreStats().entries, max)
        assert.ok(getMessageForRetry({ id: `BULK${max}` }), 'entri terbaru tersedia')
        assert.equal(getMessageForRetry({ id: 'BULK0' }), undefined, 'entri terlama sudah terbuang')
    })

    test('TTL kedaluwarsa menghapus entri', async () => {
        mock.timers.enable({ apis: ['Date'] })
        try {
            storeOutgoingMessage({ remoteJid: '628114@s.whatsapp.net', id: 'TTL1' }, CONTENT)
            assert.deepEqual(getMessageForRetry({ id: 'TTL1' }), CONTENT)

            mock.timers.tick(60 * 60_000 + 1)
            assert.equal(getMessageForRetry({ id: 'TTL1' }), undefined)
        } finally {
            mock.timers.reset()
        }
    })
})
