import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'http'
import fs from 'fs'
import os from 'os'
import path from 'path'

const tmpMe = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-me-'))
process.env.WA_DATABASE_DIR = tmpMe
process.env.WA_OWNER_PATH = path.join(tmpMe, 'owner.json')
process.env.WA_PREMIUM_PATH = path.join(tmpMe, 'premium.json')
process.env.WA_CONFIG_PATH = path.join(tmpMe, 'config.json')
fs.writeFileSync(process.env.WA_CONFIG_PATH, JSON.stringify({ botMode: 'public', prefix: ['.'], dailyLimit: 5, creator: [] }))

const { Toolkit } = await import('../src/lib/message/toolkit.js')
const { getBuffer, fetchJson } = await import('../src/utils/myfunc.js')

let server
let baseUrl

const PAYLOAD = Buffer.from('0123456789'.repeat(10))

before(async () => {
    server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://localhost')

        if (url.pathname === '/data') {
            res.writeHead(200, { 'content-type': 'application/octet-stream' })
            res.end(PAYLOAD)
            return
        }

        if (url.pathname === '/hang') {
            return
        }

        if (url.pathname === '/big') {
            res.writeHead(200, { 'content-type': 'application/octet-stream' })
            const chunk = Buffer.alloc(64 * 1024, 0x41)
            const writer = setInterval(() => {
                res.write(chunk)
            }, 5)
            setTimeout(() => {
                clearInterval(writer)
                res.end()
            }, 600)
            return
        }

        if (url.pathname === '/json') {
            res.writeHead(200, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ ok: true, value: 42 }))
            return
        }

        res.writeHead(404)
        res.end()
    })

    await new Promise(resolve => server.listen(0, resolve))
    baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
    await new Promise(resolve => server.close(resolve))
    fs.rmSync(tmpMe, { recursive: true, force: true })
})

describe('Toolkit.fetchBuffer', () => {
    test('mengunduh body utuh', async () => {
        const buffer = await Toolkit.fetchBuffer(`${baseUrl}/data`)
        assert.ok(Buffer.isBuffer(buffer))
        assert.ok(buffer.equals(PAYLOAD))
    })

    test('skema non-http ditolak', async () => {
        await assert.rejects(
            () => Toolkit.fetchBuffer('file:///etc/passwd', {}, { silent: false }),
            /Skema tidak didukung/
        )
        assert.deepEqual(await Toolkit.fetchBuffer('file:///etc/passwd'), Buffer.alloc(0))
    })

    test('timeout membatalkan unduhan', async () => {
        await assert.rejects(
            () => Toolkit.fetchBuffer(`${baseUrl}/hang`, {}, { silent: false, timeout: 200 }),
            /aborted|timeout/i
        )
        const empty = await Toolkit.fetchBuffer(`${baseUrl}/hang`, {}, { silent: true, timeout: 200 })
        assert.deepEqual(empty, Buffer.alloc(0))
    })

    test('ukuran melebihi batas di tengah stream dihentikan', async () => {
        await assert.rejects(
            () => Toolkit.fetchBuffer(`${baseUrl}/big`, {}, { silent: false, maxBytes: 100 * 1024 }),
            /melebihi batas/
        )
        const empty = await Toolkit.fetchBuffer(`${baseUrl}/big`, {}, { silent: true, maxBytes: 100 * 1024 })
        assert.deepEqual(empty, Buffer.alloc(0))
    })

    test('content-length yang sudah melebihi batas ditolak sebelum baca body', async () => {
        const headerServer = http.createServer((req, res) => {
            res.writeHead(200, { 'content-length': String(60 * 1024 * 1024) })
            res.write('x')
            res.end()
        })
        await new Promise(resolve => headerServer.listen(0, resolve))
        try {
            const url = `http://127.0.0.1:${headerServer.address().port}/x`
            await assert.rejects(
                () => Toolkit.fetchBuffer(url, {}, { silent: false }),
                /melebihi batas/
            )
        } finally {
            await new Promise(resolve => headerServer.close(resolve))
        }
    })

    test('HTTP error status tetap ditolak', async () => {
        await assert.rejects(
            () => Toolkit.fetchBuffer(`${baseUrl}/missing`, {}, { silent: false }),
            /HTTP 404/
        )
    })
})

describe('getBuffer dan fetchJson (axios)', () => {
    test('getBuffer mengunduh arraybuffer', async () => {
        const data = await getBuffer(`${baseUrl}/data`)
        assert.ok(Buffer.isBuffer(data) || data instanceof ArrayBuffer || ArrayBuffer.isView(data))
        assert.ok(Buffer.from(data).length > 0)
    })

    test('fetchJson mem-parsing JSON', async () => {
        const data = await fetchJson(`${baseUrl}/json`)
        assert.deepEqual(data, { ok: true, value: 42 })
    })

    test('getBuffer timeout pada server yang tidak merespons', async () => {
        await assert.rejects(
            () => getBuffer(`${baseUrl}/hang`, { timeout: 200 }),
            error => error?.code === 'ECONNABORTED' || /timeout/i.test(String(error?.message))
        )
    })

    test('fetchJson menolak respons melebihi maxContentLength', async () => {
        await assert.rejects(
            () => fetchJson(`${baseUrl}/big`, { maxContentLength: 50 * 1024 }),
            error => error?.code === 'ERR_FR_MAX_BODY_LENGTH_EXCEEDED' || /max|length/i.test(String(error?.message))
        )
    })
})

describe('resolveMedia memakai fetchBuffer dengan limit', () => {
    test('URL lokal diubah menjadi buffer', async () => {
        const result = await Toolkit.resolveMedia(null, `${baseUrl}/data`, 'image', { result: 'buffer' })
        assert.ok(Buffer.isBuffer(result))
        assert.ok(result.equals(PAYLOAD))
    })
})
