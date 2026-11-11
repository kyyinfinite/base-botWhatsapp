import { test, describe, before, after, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import { fileURLToPath, pathToFileURL } from 'url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-reconnect-'))

process.env.WA_DATABASE_DIR = tmp
process.env.WA_OWNER_PATH = path.join(tmp, 'owner.json')
process.env.WA_PREMIUM_PATH = path.join(tmp, 'premium.json')
process.env.WA_CONFIG_PATH = path.join(tmp, 'config.json')
fs.writeFileSync(process.env.WA_CONFIG_PATH, JSON.stringify({
    botName: 'Uji Bot',
    botMode: 'public',
    dailyLimit: 5,
    prefix: ['.'],
    creator: [],
    usePairingCode: true
}))

const connectUrl = pathToFileURL(path.join(root, 'src/core/app/connect.js')).href
const { default: connectToWhatsApp, closeActiveSocket, getActiveSocket, getConnectionStatus } = await import(connectUrl)
const { classifyDisconnect, computeBackoff, reconnectDelayFor } = await import('../src/core/app/reconnect.js')
const { flushAll } = await import('../src/services/database/json.js')

const flush = () => new Promise(resolve => setImmediate(resolve))
const closeWith = statusCode => ({ connection: 'close', lastDisconnect: { error: { output: { statusCode } } } })

function makeSocket(harness) {
    const listeners = new Map()
    const calls = { end: 0, requestPairingCode: 0, removeAllListeners: 0, credsListenersAtPairing: null }

    const sock = {
        user: { id: '628000@s.whatsapp.net' },
        calls,
        ev: {
            on(event, fn) {
                if (!listeners.has(event)) listeners.set(event, [])
                listeners.get(event).push(fn)
            },
            removeAllListeners() {
                calls.removeAllListeners += 1
                listeners.clear()
            },
            async emit(event, payload) {
                for (const fn of [...(listeners.get(event) || [])]) await fn(payload)
            },
            listenerCount(event) {
                return (listeners.get(event) || []).length
            }
        },
        async requestPairingCode() {
            calls.requestPairingCode += 1
            calls.credsListenersAtPairing = sock.ev.listenerCount('creds.update')
            return 'ABCD-EFGH'
        },
        end() {
            calls.end += 1
        }
    }

    harness.sockets.push(sock)
    return sock
}

function makeHarness({ registered = false } = {}) {
    const harness = {
        sockets: [],
        states: [],
        authArgs: [],
        created: 0,
        failNext: 0,
        gate: null,
        creds: { registered },
        log: [],
        prompts: 0,
        plugins: 0
    }

    harness.saveCreds = async () => {
        harness.log.push('save')
    }

    harness.createSocket = async ({ auth } = {}) => {
        harness.created += 1
        harness.log.push('create')
        harness.authArgs.push(auth ?? null)
        if (harness.gate) await harness.gate
        if (harness.failNext > 0) {
            harness.failNext -= 1
            throw new Error('gagal membuat socket')
        }
        const state = { creds: harness.creds }
        harness.states.push(state)
        return { sock: makeSocket(harness), state, saveCreds: () => harness.saveCreds() }
    }

    harness.options = (extra = {}) => ({
        createSocket: harness.createSocket,
        promptPhoneNumber: async () => {
            harness.prompts += 1
            return '628123456789'
        },
        initPluginStack: async () => {
            harness.plugins += 1
        },
        ...extra
    })

    harness.connect = (extra = {}) => connectToWhatsApp(harness.options(extra))

    return harness
}

function runScript(body) {
    return new Promise(resolve => {
        const child = spawn(process.execPath, ['--input-type=module', '-e', body], { env: process.env, cwd: root })
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', chunk => { stdout += chunk })
        child.stderr.on('data', chunk => { stderr += chunk })
        const killer = setTimeout(() => child.kill('SIGKILL'), 10000)
        child.on('close', (code, signal) => {
            clearTimeout(killer)
            resolve({ code, signal, stdout, stderr })
        })
    })
}

const scriptPrelude = `
import connectToWhatsApp, { closeActiveSocket } from ${JSON.stringify(connectUrl)}
const handlers = new Map()
const makeSock = (id, order) => ({
    user: { id: '1@s.whatsapp.net' },
    end() {},
    ev: {
        on(event, fn) {
            if (!handlers.has(id)) handlers.set(id, new Map())
            const byEvent = handlers.get(id)
            if (!byEvent.has(event)) byEvent.set(event, [])
            byEvent.get(event).push(fn)
        },
        removeAllListeners() { handlers.delete(id) },
        async emit(event, payload) {
            for (const fn of [...(handlers.get(id)?.get(event) || [])]) await fn(payload)
        }
    },
    async requestPairingCode() { order.push('pairing-code'); return 'ABCD-EFGH' }
})
const closeWith = statusCode => ({ connection: 'close', lastDisconnect: { error: { output: { statusCode } } } })
`

let logs
let errors

beforeEach(async () => {
    logs = []
    errors = []
    mock.method(console, 'log', (...args) => { logs.push(args.join(' ')) })
    mock.method(console, 'error', (...args) => { errors.push(args.join(' ')) })
    await closeActiveSocket()
})

afterEach(async () => {
    mock.timers.reset()
    await closeActiveSocket()
    mock.restoreAll()
})

after(async () => {
    flushAll()
    fs.rmSync(tmp, { recursive: true, force: true })
})

describe('klasifikasi status disconnect', () => {
    test('tiap status punya strategi sendiri', () => {
        assert.deepEqual(classifyDisconnect(515), { type: 'restart', reconnect: true })
        assert.deepEqual(classifyDisconnect(401), { type: 'logout', reconnect: false })
        assert.deepEqual(classifyDisconnect(440), { type: 'replaced', reconnect: true })
        for (const code of [408, 428, 503]) assert.equal(classifyDisconnect(code).type, 'transient')
        for (const code of [undefined, null, 500, 999]) assert.deepEqual(classifyDisconnect(code), { type: 'unknown', reconnect: true })
    })

    test('515 selalu 0ms, status lain memakai backoff dengan batas delay', () => {
        for (let attempt = 0; attempt < 40; attempt++) assert.equal(reconnectDelayFor('restart', attempt), 0)
        assert.ok(reconnectDelayFor('transient', 0) >= 2000)
        assert.ok(reconnectDelayFor('transient', 500) <= 60000 + 500)
        assert.ok(reconnectDelayFor('replaced', 0) >= 30000)
        assert.ok(reconnectDelayFor('replaced', 500) <= 300000 + 5000)
        assert.ok(Number.isFinite(computeBackoff(10_000)))
    })
})

describe('status 515 (restartRequired)', () => {
    beforeEach(() => {
        mock.timers.enable({ apis: ['setTimeout'] })
    })

    test('515 memicu reconnect segera dan membuat socket baru', async () => {
        const h = makeHarness({ registered: true })
        const first = await h.connect()
        await first.ev.emit('connection.update', { connection: 'open' })

        await first.ev.emit('connection.update', closeWith(515))
        assert.equal(getConnectionStatus().reconnectScheduled, true)
        assert.equal(h.created, 1)

        mock.timers.tick(1)
        await flush()

        assert.equal(h.created, 2)
        assert.notEqual(getActiveSocket(), first)
        assert.equal(getActiveSocket(), h.sockets[1])
        assert.ok(logs.some(line => line.includes('Status 515 terdeteksi')))
    })

    test('515 tidak dihitung sebagai retry gagal dan tidak memakai backoff', async () => {
        const h = makeHarness({ registered: true })
        let sock = await h.connect()

        for (let i = 0; i < 3; i++) {
            await sock.ev.emit('connection.update', closeWith(515))
            mock.timers.tick(1)
            await flush()
            sock = getActiveSocket()
        }

        assert.equal(h.created, 4)
        assert.equal(getConnectionStatus().attempts, 0)
    })

    test('515 beruntun tanpa pernah open diberi jeda tetap, bukan loop rapat', async () => {
        const h = makeHarness({ registered: true })
        let sock = await h.connect()

        for (let i = 0; i < 5; i++) {
            await sock.ev.emit('connection.update', closeWith(515))
            mock.timers.tick(1)
            await flush()
            sock = getActiveSocket()
        }
        assert.equal(h.created, 6)

        await sock.ev.emit('connection.update', closeWith(515))
        mock.timers.tick(1)
        await flush()
        assert.equal(h.created, 6, 'restart ke-6 menunggu jeda')

        mock.timers.tick(1000)
        await flush()
        assert.equal(h.created, 7)
        assert.equal(getConnectionStatus().attempts, 0)
    })

    test('kredensial tersimpan sebelum socket baru dibuat', async () => {
        const h = makeHarness({ registered: true })
        let release
        const gate = new Promise(resolve => { release = resolve })
        h.saveCreds = async () => {
            h.log.push('save-start')
            await gate
            h.log.push('save-end')
        }

        const first = await h.connect()
        await first.ev.emit('connection.update', { connection: 'open' })
        await first.ev.emit('creds.update', {})
        await first.ev.emit('connection.update', closeWith(515))

        mock.timers.tick(1)
        await flush()
        assert.equal(h.created, 1, 'socket baru menunggu penyimpanan selesai')

        release()
        await flush()

        assert.equal(h.created, 2)
        assert.deepEqual(h.log, ['create', 'save-start', 'save-end', 'create'])
    })

    test('penyimpanan kredensial diserialkan dan tidak saling timpa', async () => {
        const h = makeHarness({ registered: true })
        let active = 0
        let maxActive = 0
        h.saveCreds = async () => {
            active += 1
            maxActive = Math.max(maxActive, active)
            await flush()
            active -= 1
            h.log.push('save')
        }

        const sock = await h.connect()
        await sock.ev.emit('creds.update', {})
        await sock.ev.emit('creds.update', {})
        await sock.ev.emit('creds.update', {})
        await closeActiveSocket()

        assert.equal(maxActive, 1)
        assert.equal(h.log.filter(item => item === 'save').length, 3)
    })

    test('gagal menyimpan dilaporkan, dicoba ulang sebelum socket baru, dan tidak menghentikan reconnect', async () => {
        const h = makeHarness({ registered: true })
        let attempts = 0
        h.saveCreds = async () => {
            attempts += 1
            if (attempts === 1) throw new Error('disk penuh')
            h.log.push('save')
        }

        const first = await h.connect()
        await first.ev.emit('creds.update', {})
        await first.ev.emit('connection.update', closeWith(515))
        mock.timers.tick(1)
        await flush()

        assert.ok(errors.some(line => line.includes('runtime:creds')))
        assert.equal(attempts, 2)
        assert.equal(h.created, 2)
    })

    test('pairing tidak diulang setelah session registered dan auth state dipakai ulang', async () => {
        const h = makeHarness({ registered: false })
        const first = await h.connect()

        assert.equal(h.prompts, 1)
        assert.equal(first.calls.requestPairingCode, 1)

        h.creds.registered = true
        await first.ev.emit('creds.update', { registered: true })
        await first.ev.emit('connection.update', { isNewLogin: true })
        await first.ev.emit('connection.update', closeWith(515))
        mock.timers.tick(1)
        await flush()

        const second = getActiveSocket()
        assert.equal(h.created, 2)
        assert.equal(h.prompts, 1, 'tidak ada prompt nomor kedua')
        assert.equal(second.calls.requestPairingCode, 0)
        assert.equal(h.authArgs[1].state, h.states[0], 'socket baru memakai auth state yang sama')
        assert.ok(logs.some(line => line.includes('Pairing berhasil')))
    })

    test('creds.update sudah aktif sebelum requestPairingCode', async () => {
        const h = makeHarness({ registered: false })
        const sock = await h.connect()
        assert.equal(sock.calls.credsListenersAtPairing, 1)
    })

    test('pairing yang tertunda tidak memblokir reconnect saat socket tertutup', async () => {
        const h = makeHarness({ registered: false })
        const pending = h.connect({ promptPhoneNumber: () => new Promise(() => {}) })
        await flush()

        await h.sockets[0].ev.emit('connection.update', closeWith(408))
        const result = await pending
        assert.ok(result)

        mock.timers.tick(2500)
        await flush()
        assert.equal(h.created, 2)
    })

    test('sesi tidak dihapus dan session dir tidak disentuh saat 515', async () => {
        const h = makeHarness({ registered: true })
        const first = await h.connect()
        await first.ev.emit('connection.update', closeWith(515))
        mock.timers.tick(1)
        await flush()

        assert.equal(h.creds.registered, true)
        assert.equal(getConnectionStatus().loggedOut, false)
    })
})

describe('reconnect tanpa duplikasi', () => {
    test('tidak ada socket ganda dari close berulang dan connect paralel', async () => {
        mock.timers.enable({ apis: ['setTimeout'] })
        const h = makeHarness({ registered: true })
        const first = await h.connect()

        await first.ev.emit('connection.update', closeWith(515))
        await first.ev.emit('connection.update', closeWith(515))

        const results = await Promise.all([h.connect(), h.connect(), h.connect()])
        mock.timers.tick(60000)
        await flush()

        assert.equal(h.created, 2)
        assert.equal(new Set(results).size, 1)
        assert.equal(getActiveSocket(), results[0])
    })

    test('timer reconnect hanya satu dan menahan event loop (tidak di-unref)', async () => {
        const created = []
        const realSetTimeout = globalThis.setTimeout
        globalThis.setTimeout = (fn, ms, ...args) => {
            const timer = realSetTimeout(fn, ms, ...args)
            created.push({ ms, timer })
            return timer
        }

        try {
            const h = makeHarness({ registered: true })
            const first = await h.connect()
            await first.ev.emit('connection.update', closeWith(408))
            await first.ev.emit('connection.update', closeWith(408))
            await first.ev.emit('connection.update', closeWith(503))

            assert.equal(created.length, 1)
            assert.equal(created[0].timer.hasRef(), true)
            assert.ok(created[0].ms >= 2000)
        } finally {
            globalThis.setTimeout = realSetTimeout
        }
    })

    test('listener tidak terduplikasi dan listener socket lama dilepas', async () => {
        mock.timers.enable({ apis: ['setTimeout'] })
        const h = makeHarness({ registered: true })
        const first = await h.connect()
        await first.ev.emit('connection.update', { connection: 'open' })
        await first.ev.emit('connection.update', closeWith(515))
        mock.timers.tick(1)
        await flush()

        const second = getActiveSocket()
        for (const event of ['creds.update', 'connection.update', 'messages.upsert']) {
            assert.equal(second.ev.listenerCount(event), 1, `${event} di socket baru`)
            assert.equal(first.ev.listenerCount(event), 0, `${event} di socket lama`)
        }
    })

    test('creds.update dari socket lama tidak menimpa penyimpanan', async () => {
        mock.timers.enable({ apis: ['setTimeout'] })
        const h = makeHarness({ registered: true })
        const first = await h.connect()
        await first.ev.emit('connection.update', closeWith(515))
        mock.timers.tick(1)
        await flush()

        const before = h.log.filter(item => item === 'save').length
        await first.ev.emit('creds.update', {})
        await flush()
        assert.equal(h.log.filter(item => item === 'save').length, before)
    })
})

describe('strategi per status', () => {
    beforeEach(() => {
        mock.timers.enable({ apis: ['setTimeout'] })
    })

    test('408 memakai backoff dengan jitter', async () => {
        const h = makeHarness({ registered: true })
        const sock = await h.connect()
        await sock.ev.emit('connection.update', closeWith(408))

        mock.timers.tick(1999)
        await flush()
        assert.equal(h.created, 1)

        mock.timers.tick(501)
        await flush()
        assert.equal(h.created, 2)
    })

    test('503 memakai backoff yang naik di percobaan berikutnya', async () => {
        const h = makeHarness({ registered: true })
        const first = await h.connect()
        await first.ev.emit('connection.update', closeWith(503))
        mock.timers.tick(2500)
        await flush()
        assert.equal(h.created, 2)

        await getActiveSocket().ev.emit('connection.update', closeWith(503))
        mock.timers.tick(3999)
        await flush()
        assert.equal(h.created, 2)

        mock.timers.tick(501)
        await flush()
        assert.equal(h.created, 3)
        assert.equal(getConnectionStatus().attempts, 2)
    })

    test('batas delay backoff dipakai, jumlah retry tidak dibatasi', async () => {
        const h = makeHarness({ registered: true })
        let sock = await h.connect()

        for (let i = 0; i < 25; i++) {
            await sock.ev.emit('connection.update', closeWith(428))
            mock.timers.tick(60500)
            await flush()
            sock = getActiveSocket()
            assert.ok(sock, `reconnect ke-${i + 1} tetap berjalan`)
        }

        assert.equal(h.created, 26)
    })

    test('401 tidak reconnect dan memberi instruksi autentikasi ulang', async () => {
        const h = makeHarness({ registered: true })
        const sock = await h.connect()
        await sock.ev.emit('connection.update', { connection: 'open' })
        await sock.ev.emit('connection.update', closeWith(401))

        mock.timers.tick(600000)
        await flush()

        assert.equal(h.created, 1)
        assert.equal(getConnectionStatus().loggedOut, true)
        assert.equal(getConnectionStatus().reconnectScheduled, false)
        assert.ok(logs.some(line => line.includes('Hapus folder session')))
    })

    test('440 mundur lama dan socket yang digantikan dihentikan', async () => {
        const h = makeHarness({ registered: true })
        const sock = await h.connect()
        await sock.ev.emit('connection.update', closeWith(440))

        assert.equal(sock.calls.end, 1)
        assert.equal(getActiveSocket(), null)

        mock.timers.tick(29999)
        await flush()
        assert.equal(h.created, 1)

        mock.timers.tick(5001)
        await flush()
        assert.equal(h.created, 2)
    })

    test('status tidak dikenal reconnect dengan backoff', async () => {
        const h = makeHarness({ registered: true })
        const sock = await h.connect()
        await sock.ev.emit('connection.update', closeWith(undefined))

        mock.timers.tick(1999)
        await flush()
        assert.equal(h.created, 1)

        mock.timers.tick(501)
        await flush()
        assert.equal(h.created, 2)
    })

    test('log reconnect yang sama tidak membanjiri terminal', async () => {
        const h = makeHarness({ registered: true })
        let sock = await h.connect()

        for (let i = 0; i < 12; i++) {
            await sock.ev.emit('connection.update', closeWith(408))
            mock.timers.tick(60500)
            await flush()
            sock = getActiveSocket()
        }

        const lines = logs.filter(line => line.includes('Koneksi terputus'))
        assert.ok(lines.length < 12, `hanya ${lines.length} dari 12 yang tercetak`)
        assert.ok(lines.length >= 3)
    })
})

describe('kegagalan membuat socket', () => {
    beforeEach(() => {
        mock.timers.enable({ apis: ['setTimeout'] })
    })

    test('kegagalan setelah 515 tetap dijadwalkan ulang sampai berhasil', async () => {
        const rejections = []
        const onRejection = reason => rejections.push(reason)
        process.on('unhandledRejection', onRejection)

        try {
            const h = makeHarness({ registered: true })
            const first = await h.connect()
            await first.ev.emit('connection.update', { connection: 'open' })
            h.failNext = 2

            await first.ev.emit('connection.update', closeWith(515))
            mock.timers.tick(1)
            await flush()
            assert.equal(h.created, 2)
            assert.equal(getConnectionStatus().reconnectScheduled, true)

            mock.timers.tick(2500)
            await flush()
            assert.equal(h.created, 3)
            assert.equal(getConnectionStatus().reconnectScheduled, true)

            mock.timers.tick(4500)
            await flush()
            assert.equal(h.created, 4)
            assert.equal(getActiveSocket(), h.sockets[1])
            assert.equal(rejections.length, 0)
            assert.ok(errors.some(line => line.includes('runtime:connect')))
        } finally {
            process.off('unhandledRejection', onRejection)
        }
    })

    test('kegagalan koneksi pertama kali tidak melempar dan tetap dicoba ulang', async () => {
        const h = makeHarness({ registered: true })
        h.failNext = 1

        const result = await h.connect()
        assert.equal(result, null)
        assert.equal(getConnectionStatus().reconnectScheduled, true)

        mock.timers.tick(2500)
        await flush()
        assert.equal(h.created, 2)
        assert.ok(getActiveSocket())
    })
})

describe('shutdown', () => {
    beforeEach(() => {
        mock.timers.enable({ apis: ['setTimeout'] })
    })

    test('shutdown membatalkan reconnect yang terjadwal', async () => {
        const h = makeHarness({ registered: true })
        const sock = await h.connect()
        await sock.ev.emit('connection.update', closeWith(408))
        assert.equal(getConnectionStatus().reconnectScheduled, true)

        await closeActiveSocket()
        mock.timers.tick(600000)
        await flush()

        assert.equal(h.created, 1)
        assert.equal(getConnectionStatus().reconnectScheduled, false)
    })

    test('shutdown saat socket baru sedang dibuat tidak meninggalkan socket aktif', async () => {
        const h = makeHarness({ registered: true })
        const first = await h.connect()
        await first.ev.emit('connection.update', { connection: 'open' })

        let release
        h.gate = new Promise(resolve => { release = resolve })

        await first.ev.emit('connection.update', closeWith(515))
        mock.timers.tick(1)
        await flush()
        assert.equal(h.created, 2)

        await closeActiveSocket()
        release()
        await flush()

        assert.equal(getActiveSocket(), null)
        assert.equal(h.sockets[1].calls.end, 1)
        assert.equal(getConnectionStatus().reconnectScheduled, false)

        mock.timers.tick(600000)
        await flush()
        assert.equal(h.created, 2)
    })

    test('shutdown menunggu penyimpanan kredensial yang masih berjalan', async () => {
        const h = makeHarness({ registered: true })
        let release
        const gate = new Promise(resolve => { release = resolve })
        h.saveCreds = async () => {
            await gate
            h.log.push('saved')
        }

        const sock = await h.connect()
        await sock.ev.emit('creds.update', {})

        let closed = false
        const closing = closeActiveSocket().then(() => { closed = true })
        await flush()
        assert.equal(closed, false)

        release()
        await closing
        assert.deepEqual(h.log, ['create', 'saved'])
    })
})

describe('plugin lifecycle', () => {
    test('plugin tidak diinisialisasi ulang saat reconnect', async () => {
        mock.timers.enable({ apis: ['setTimeout'] })
        const h = makeHarness({ registered: true })
        const first = await h.connect()
        await first.ev.emit('connection.update', { connection: 'open' })
        await flush()

        await first.ev.emit('connection.update', closeWith(515))
        mock.timers.tick(1)
        await flush()
        await getActiveSocket().ev.emit('connection.update', { connection: 'open' })

        await getActiveSocket().ev.emit('connection.update', closeWith(408))
        mock.timers.tick(2500)
        await flush()
        await getActiveSocket().ev.emit('connection.update', { connection: 'open' })
        await flush()

        assert.equal(h.created, 3)
        assert.equal(h.plugins, 1)
    })
})

describe('runtime tetap hidup (proses nyata)', () => {
    test('timer reconnect mempertahankan proses Node saat tidak ada handle lain', async () => {
        const result = await runScript(`${scriptPrelude}
let created = 0
const order = []
const createSocket = async () => {
    created += 1
    if (created === 2) {
        console.log('RECONNECTED')
        setImmediate(() => closeActiveSocket())
    }
    return { sock: makeSock(created, order), state: { creds: { registered: true } }, saveCreds: async () => {} }
}
process.on('exit', () => console.log('EXIT created=' + created))
const first = await connectToWhatsApp({ createSocket, reconnectDelay: () => 300, initPluginStack: async () => {} })
await first.ev.emit('connection.update', { connection: 'open' })
await first.ev.emit('connection.update', closeWith(408))
`)

        assert.equal(result.signal, null)
        assert.equal(result.code, 0, result.stderr)
        assert.match(result.stdout, /RECONNECTED/, 'proses tidak boleh keluar sebelum reconnect jalan')
        assert.match(result.stdout, /EXIT created=2/)
    })

    test('urutan pairing sukses, 515, reconnect, open berjalan utuh', async () => {
        const result = await runScript(`${scriptPrelude}
let created = 0
const order = []
const creds = { registered: false }
const createSocket = async () => {
    created += 1
    const n = created
    order.push('create#' + n + (creds.registered ? ':registered' : ':new'))
    const sock = makeSock(n, order)
    if (n === 2) {
        setImmediate(async () => {
            await sock.ev.emit('connection.update', { connection: 'connecting' })
            await sock.ev.emit('connection.update', { connection: 'open' })
            order.push('open#2')
            console.log('ORDER ' + JSON.stringify(order))
            await closeActiveSocket()
        })
    }
    return { sock, state: { creds }, saveCreds: async () => { order.push('saved') } }
}
const first = await connectToWhatsApp({
    createSocket,
    promptPhoneNumber: async () => { order.push('prompt'); return '628123' },
    initPluginStack: async () => { order.push('plugins') }
})
await first.ev.emit('connection.update', { connection: 'connecting' })
creds.registered = true
await first.ev.emit('creds.update', { registered: true })
await first.ev.emit('connection.update', { isNewLogin: true })
await first.ev.emit('connection.update', closeWith(515))
`)

        assert.equal(result.code, 0, result.stderr)
        const line = result.stdout.split('\n').find(item => item.startsWith('ORDER '))
        assert.ok(line, `tidak sampai open#2. stdout: ${result.stdout}`)
        const order = JSON.parse(line.slice(6))

        assert.equal(order.filter(item => item === 'prompt').length, 1)
        assert.equal(order.filter(item => item === 'pairing-code').length, 1)
        assert.equal(order.filter(item => item === 'plugins').length, 1)
        assert.ok(order.indexOf('saved') < order.indexOf('create#2:registered'), 'kredensial tersimpan sebelum socket baru')
        assert.equal(order.at(-1), 'open#2')
    })

    test('gagal membuat socket saat start tidak mematikan proses', async () => {
        const result = await runScript(`${scriptPrelude}
let created = 0
const order = []
const createSocket = async () => {
    created += 1
    if (created < 3) throw new Error('belum siap')
    console.log('RECOVERED created=' + created)
    setImmediate(() => closeActiveSocket())
    return { sock: makeSock(created, order), state: { creds: { registered: true } }, saveCreds: async () => {} }
}
await connectToWhatsApp({ createSocket, reconnectDelay: () => 80, initPluginStack: async () => {} })
`)

        assert.equal(result.code, 0, result.stderr)
        assert.match(result.stdout, /RECOVERED created=3/)
    })
})
