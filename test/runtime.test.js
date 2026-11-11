import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'

const tmpRt = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-rt-'))
process.env.WA_DATABASE_DIR = tmpRt
process.env.WA_OWNER_PATH = path.join(tmpRt, 'owner.json')
process.env.WA_PREMIUM_PATH = path.join(tmpRt, 'premium.json')
process.env.WA_CONFIG_PATH = path.join(tmpRt, 'config.json')
fs.writeFileSync(process.env.WA_CONFIG_PATH, JSON.stringify({
    botName: 'Uji Bot',
    botMode: 'public',
    dailyLimit: 5,
    prefix: ['.'],
    creator: [],
    usePairingCode: true
}))

const { computeBackoff, shouldReconnect, RECONNECT_BASE_MS, RECONNECT_MAX_MS } = await import('../src/core/app/reconnect.js')
const connectModule = await import('../src/core/app/connect.js')
const { default: connectToWhatsApp, closeActiveSocket, getActiveSocket } = connectModule
const { setResolverSocket, resetResolverState, peekPNForLID } = await import('../src/services/identity-resolver.js')
const { flushAll } = await import('../src/services/database/json.js')

const sleep = ms => new Promise(r => setTimeout(r, ms))

function makeMockSocket({ registered = false } = {}) {
    const listeners = new Map()
    const calls = { end: 0, requestPairingCode: 0, removeAllListeners: 0 }

    const sock = {
        user: { id: '628000@s.whatsapp.net' },
        calls,
        creds: { registered },
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
                for (const fn of [...(listeners.get(event) || [])]) {
                    await fn(payload)
                }
            },
            listenerCount(event) {
                return (listeners.get(event) || []).length
            }
        },
        async requestPairingCode() {
            calls.requestPairingCode += 1
            return 'ABCD-EFGH'
        },
        async end() {
            calls.end += 1
            await sock.ev.emit('connection.update', {
                connection: 'close',
                lastDisconnect: { error: { output: { statusCode: 1000 } } }
            })
        }
    }

    return sock
}

const makeCreateSocket = sockets => {
    const state = {
        created: 0,
        creds: { registered: false },
        saveCredsCalls: 0
    }

    const createSocket = async () => {
        state.created += 1
        const sock = makeMockSocket({ registered: state.creds.registered })
        sockets.push(sock)
        return {
            sock,
            state: { creds: state.creds },
            saveCreds: () => {
                state.saveCredsCalls += 1
            }
        }
    }

    return { createSocket, state }
}

const quickBackoff = () => 15

beforeEach(async () => {
    await closeActiveSocket()
    resetResolverState()
})

before(async () => {
    resetResolverState()
})

after(async () => {
    await closeActiveSocket()
    resetResolverState()
    flushAll()
    fs.rmSync(tmpRt, { recursive: true, force: true })
})

describe('reconnect backoff', () => {
    test('backoff pertama minimal base', () => {
        const delay = computeBackoff(0)
        assert.ok(delay >= RECONNECT_BASE_MS, `delay ${delay} harus >= ${RECONNECT_BASE_MS}`)
        assert.ok(delay <= RECONNECT_BASE_MS + 500 + 10)
    })

    test('backoff tumbuh eksponensial', () => {
        assert.ok(computeBackoff(1) >= 4000)
        assert.ok(computeBackoff(2) >= 8000)
        assert.ok(computeBackoff(3) >= 16000)
    })

    test('backoff dibatasi max', () => {
        for (let attempt = 10; attempt < 15; attempt++) {
            const delay = computeBackoff(attempt)
            assert.ok(delay <= RECONNECT_MAX_MS + 500, `delay ${delay} melebihi max`)
        }
    })

    test('input aneh tidak melempar error', () => {
        assert.ok(computeBackoff(-5) >= RECONNECT_BASE_MS)
        assert.ok(computeBackoff(NaN) >= RECONNECT_BASE_MS)
        assert.ok(computeBackoff('x') >= RECONNECT_BASE_MS)
    })
})

describe('keputusan reconnect', () => {
    test('loggedOut (401) tidak reconnect', () => {
        assert.equal(shouldReconnect(401), false)
    })

    test('status lain reconnect', () => {
        assert.equal(shouldReconnect(515), true)
        assert.equal(shouldReconnect(428), true)
        assert.equal(shouldReconnect(440), true)
    })

    test('status undefined reconnect', () => {
        assert.equal(shouldReconnect(undefined), true)
        assert.equal(shouldReconnect(null), true)
    })
})

describe('pairing state', () => {
    test('pairing diminta saat creds belum terdaftar', async () => {
        const sockets = []
        const { createSocket } = makeCreateSocket(sockets)
        const prompts = []

        const sock = await connectToWhatsApp({
            createSocket,
            promptPhoneNumber: async () => {
                prompts.push('prompted')
                return '628123456789'
            },
            reconnectDelay: quickBackoff,
            initPluginStack: async () => {}
        })

        assert.equal(prompts.length, 1, 'pairing code diminta ketika belum registered')
        assert.equal(sock.calls.requestPairingCode, 1)
        assert.ok(sock.creds.registered === false, 'keputusan pairing memakai state.creds.registered')

        await closeActiveSocket()
    })

    test('pairing dilewati saat creds sudah terdaftar', async () => {
        const sockets = []
        const { createSocket, state } = makeCreateSocket(sockets)
        state.creds.registered = true
        const prompts = []

        const sock = await connectToWhatsApp({
            createSocket,
            promptPhoneNumber: async () => {
                prompts.push('prompted')
                return '628123456789'
            },
            reconnectDelay: quickBackoff,
            initPluginStack: async () => {}
        })

        assert.equal(prompts.length, 0, 'tidak ada prompt saat sudah registered')
        assert.equal(sock.calls.requestPairingCode, 0)

        await closeActiveSocket()
    })

    test('pairing dilewati saat mode QR (usePairingCode false)', async () => {
        const { updateConfig } = await import('../src/services/config.js')
        updateConfig({ usePairingCode: false })

        try {
            const sockets = []
            const { createSocket } = makeCreateSocket(sockets)
            const prompts = []

            const sock = await connectToWhatsApp({
                createSocket,
                promptPhoneNumber: async () => {
                    prompts.push('prompted')
                    return '628123456789'
                },
                reconnectDelay: quickBackoff,
                initPluginStack: async () => {}
            })

            assert.equal(prompts.length, 0)
            assert.equal(sock.calls.requestPairingCode, 0)
            await closeActiveSocket()
        } finally {
            updateConfig({ usePairingCode: true })
        }
    })

    test('gagal pairing tidak menggagalkan koneksi', async () => {
        const sockets = []
        const { createSocket } = makeCreateSocket(sockets)

        const sock = await connectToWhatsApp({
            createSocket,
            promptPhoneNumber: async () => {
                throw new Error('stdin tertutup')
            },
            reconnectDelay: quickBackoff,
            initPluginStack: async () => {}
        })

        assert.ok(sock, 'socket tetap dibuat meski pairing gagal')
        await closeActiveSocket()
    })
})

describe('connection lifecycle', () => {
    test('pemanggilan ganda saat koneksi aktif tidak membuat socket baru', async () => {
        const sockets = []
        const { createSocket, state } = makeCreateSocket(sockets)
        state.creds.registered = true

        const first = await connectToWhatsApp({
            createSocket,
            reconnectDelay: quickBackoff,
            initPluginStack: async () => {}
        })
        await first.ev.emit('connection.update', { connection: 'open' })

        const second = await connectToWhatsApp({ createSocket, reconnectDelay: quickBackoff })

        assert.equal(second, first, 'socket sama dikembalikan, tidak ada koneksi ganda')
        assert.equal(state.created, 1)

        await closeActiveSocket()
    })

    test('koneksi open menjalankan init plugin sekali saja', async () => {
        const sockets = []
        const { createSocket, state } = makeCreateSocket(sockets)
        state.creds.registered = true
        let inits = 0

        const sock = await connectToWhatsApp({
            createSocket,
            reconnectDelay: quickBackoff,
            initPluginStack: async () => {
                inits += 1
            }
        })

        await sock.ev.emit('connection.update', { connection: 'open' })
        await sock.ev.emit('connection.update', { connection: 'open' })

        assert.equal(inits, 1)
        await closeActiveSocket()
    })

    test('disconnect memicu reconnect tepat satu kali', async () => {
        const sockets = []
        const { createSocket, state } = makeCreateSocket(sockets)
        state.creds.registered = true

        const sock = await connectToWhatsApp({
            createSocket,
            reconnectDelay: quickBackoff,
            initPluginStack: async () => {}
        })
        await sock.ev.emit('connection.update', { connection: 'open' })

        await sock.ev.emit('connection.update', {
            connection: 'close',
            lastDisconnect: { error: { output: { statusCode: 515 } } }
        })
        await sock.ev.emit('connection.update', {
            connection: 'close',
            lastDisconnect: { error: { output: { statusCode: 515 } } }
        })

        await sleep(80)

        assert.equal(state.created, 2, 'reconnect membuat satu socket baru')
        assert.ok(sockets.length === 2)

        await closeActiveSocket()
    })

    test('logged out tidak reconnect', async () => {
        const sockets = []
        const { createSocket, state } = makeCreateSocket(sockets)
        state.creds.registered = true

        const sock = await connectToWhatsApp({
            createSocket,
            reconnectDelay: quickBackoff,
            initPluginStack: async () => {}
        })
        await sock.ev.emit('connection.update', { connection: 'open' })
        await sock.ev.emit('connection.update', {
            connection: 'close',
            lastDisconnect: { error: { output: { statusCode: 401 } } }
        })

        await sleep(80)
        assert.equal(state.created, 1, 'tidak ada reconnect setelah logged out')

        await closeActiveSocket()
    })

    test('shutdown membersihkan socket dan listener', async () => {
        const sockets = []
        const { createSocket, state } = makeCreateSocket(sockets)
        state.creds.registered = true

        const sock = await connectToWhatsApp({
            createSocket,
            reconnectDelay: quickBackoff,
            initPluginStack: async () => {}
        })
        await sock.ev.emit('connection.update', { connection: 'open' })

        await closeActiveSocket()

        assert.equal(getActiveSocket(), null)
        assert.ok(sock.calls.removeAllListeners >= 1, 'listener dibersihkan')
        assert.equal(sock.calls.end, 1, 'socket diakhiri')
        assert.equal(peekPNForLID('555444333222111@lid'), null, 'resolver tidak lagi memakai socket aktif')
    })

    test('shutdown membatalkan reconnect yang terjadwal', async () => {
        const sockets = []
        const { createSocket, state } = makeCreateSocket(sockets)
        state.creds.registered = true

        const sock = await connectToWhatsApp({
            createSocket,
            reconnectDelay: () => 60,
            initPluginStack: async () => {}
        })
        await sock.ev.emit('connection.update', {
            connection: 'close',
            lastDisconnect: { error: { output: { statusCode: 408 } } }
        })

        await closeActiveSocket()
        await sleep(120)

        assert.equal(state.created, 1, 'reconnect terjadwal dibatalkan saat shutdown')
    })

    test('event dari socket lama diabaikan setelah reconnect', async () => {
        const sockets = []
        const { createSocket, state } = makeCreateSocket(sockets)
        state.creds.registered = true

        const first = await connectToWhatsApp({
            createSocket,
            reconnectDelay: quickBackoff,
            initPluginStack: async () => {}
        })
        await first.ev.emit('connection.update', { connection: 'open' })

        await first.ev.emit('connection.update', {
            connection: 'close',
            lastDisconnect: { error: { output: { statusCode: 515 } } }
        })
        await sleep(80)

        assert.equal(state.created, 2)
        assert.notEqual(getActiveSocket(), first)

        await first.ev.emit('connection.update', { connection: 'open' })
        assert.equal(getActiveSocket(), sockets[1], 'socket lama tidak bisa mengambil alih')

        await closeActiveSocket()
    })

    test('listener socket lama dibersihkan saat reconnect', async () => {
        const sockets = []
        const { createSocket, state } = makeCreateSocket(sockets)
        state.creds.registered = true

        const first = await connectToWhatsApp({
            createSocket,
            reconnectDelay: quickBackoff,
            initPluginStack: async () => {}
        })
        await first.ev.emit('connection.update', { connection: 'open' })

        await first.ev.emit('connection.update', {
            connection: 'close',
            lastDisconnect: { error: { output: { statusCode: 515 } } }
        })
        await sleep(80)

        assert.ok(first.calls.removeAllListeners >= 1, 'listener socket lama dibersihkan saat close')
        assert.ok(first.ev.listenerCount('messages.upsert') === 0)

        await closeActiveSocket()
    })
})

describe('resolver binding pada runtime', () => {
    test('socket aktif dipakai sebagai sumber mapping', async () => {
        const sockets = []
        const { createSocket, state } = makeCreateSocket(sockets)
        state.creds.registered = true

        const { captureFromMessage, resolvePN } = await import('../src/services/identity-resolver.js')
        const mappingStore = {
            calls: { store: 0, getPN: 0 },
            async getPNForLID() {
                this.calls.getPN += 1
                return null
            },
            async getLIDForPN() { return null },
            async storeLIDPNMappings() { this.calls.store += 1 }
        }

        const sock = await connectToWhatsApp({
            createSocket,
            reconnectDelay: quickBackoff,
            initPluginStack: async () => {}
        })
        sock.signalRepository = { lidMapping: mappingStore }
        setResolverSocket(sock)

        await captureFromMessage({
            remoteJid: '555444333222111@lid',
            remoteJidAlt: '628111222333@s.whatsapp.net'
        })

        assert.equal(mappingStore.calls.store, 1, 'mapping dikirim ke store socket aktif')
        assert.equal(peekPNForLID('555444333222111@lid'), '628111222333@s.whatsapp.net')

        await closeActiveSocket()

        const pn = await resolvePN('555444333222111@lid')
        assert.equal(pn, '628111222333@s.whatsapp.net', 'mapping lokal tetap bisa dipakai tanpa socket')
        assert.equal(mappingStore.calls.getPN, 0, 'tidak ada lookup Baileys setelah socket dilepas')
    })
})
