import readline from 'readline'
import pino from 'pino'
import chalk from 'chalk'

import {
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    fetchLatestBaileysVersion,
    makeWASocket
} from '@whiskeysockets/baileys'

import { smsg } from '../../utils/myfunc.js'
import { normalizeLid, isJidStatus } from '../../utils/jid.js'
import handleMessage from '../dispatcher/dispatcher.js'
import { initPlugins } from '../plugin/loader.js'
import { classifyDisconnect, reconnectDelayFor, describeDisconnect } from './reconnect.js'
import { getConfig } from '../../services/config.js'
import { reportPluginError } from '../errors/engine.js'
import { setResolverSocket, captureFromContacts } from '../../services/identity-resolver.js'

const AUTH_DIR = './session'
const FAST_RESTART_LIMIT = 5
const RESTART_COOLDOWN_MS = 1000
const LOG_REPEAT_LIMIT = 3
const LOG_REPEAT_EVERY = 10

let rl = null

const question = text => {
    if (!rl) {
        rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    }
    return new Promise(resolve => rl.question(text, resolve))
}

const closePrompt = () => {
    if (!rl) return
    rl.close()
    rl = null
}

async function defaultPromptPhoneNumber() {
    const answer = await question('\nSilahkan masukkan nomor (628xxx):\n')
    closePrompt()
    return answer
}

let activeSession = null
let generation = 0
let reconnectAttempts = 0
let restartStreak = 0
let reconnectTimer = null
let connectingPromise = null
let pluginsStarted = false
let activeOptions = null
let loggedOut = false
let lastAuth = null
let waVersion = null
let saveChain = Promise.resolve()
let saveFailed = false
let reconnectLog = { key: null, count: 0 }

const log = (text, color = chalk.cyan) => console.log(color(`[WA] ${text}`))

export function getActiveSocket() {
    return activeSession?.sock ?? null
}

export function getConnectionStatus() {
    return {
        state: activeSession?.state ?? 'closed',
        loggedOut,
        reconnectScheduled: reconnectTimer !== null,
        attempts: reconnectAttempts
    }
}

function createSession(sock, gen, auth) {
    let release
    const released = new Promise(resolve => {
        release = resolve
    })
    return { sock, gen, auth, state: 'connecting', released, release }
}

function cleanupSocket(sock) {
    try {
        sock.ev?.removeAllListeners?.()
    } catch {}
    try {
        sock.end?.(new Error('socket ditutup'))
    } catch {}
    try {
        sock.signalRepository?.close?.()
    } catch {}
}

function endSession(session) {
    if (session.state === 'closed') return
    session.state = 'closed'
    session.release()
    cleanupSocket(session.sock)

    if (activeSession === session) {
        activeSession = null
        setResolverSocket(null)
    }
}

function clearReconnectTimer() {
    if (!reconnectTimer) return
    clearTimeout(reconnectTimer)
    reconnectTimer = null
}

export async function closeActiveSocket() {
    generation += 1
    pluginsStarted = false
    loggedOut = false
    lastAuth = null
    activeOptions = null
    reconnectAttempts = 0
    restartStreak = 0
    reconnectLog = { key: null, count: 0 }
    clearReconnectTimer()

    if (activeSession) endSession(activeSession)

    await saveChain
}

function queueSave(saveCreds) {
    saveChain = saveChain.then(async () => {
        try {
            await saveCreds()
            saveFailed = false
        } catch (error) {
            saveFailed = true
            reportPluginError('runtime:creds', error, {})
        }
    })
    return saveChain
}

async function flushCreds() {
    await saveChain
    if (saveFailed && lastAuth) await queueSave(lastAuth.saveCreds)
    if (saveFailed) log('Kredensial belum berhasil tersimpan, cek izin tulis folder session.', chalk.red)
}

function logReconnect(statusCode, type, delay) {
    const key = `${type}:${statusCode ?? '-'}`
    reconnectLog = key === reconnectLog.key ? { key, count: reconnectLog.count + 1 } : { key, count: 1 }
    if (reconnectLog.count > LOG_REPEAT_LIMIT && reconnectLog.count % LOG_REPEAT_EVERY !== 0) return

    if (type === 'restart') {
        log('Status 515 terdeteksi, membuat socket baru...', chalk.yellow)
        return
    }

    const seconds = (delay / 1000).toFixed(1)
    const repeat = reconnectLog.count > LOG_REPEAT_LIMIT ? ` (percobaan ke-${reconnectLog.count})` : ''

    if (type === 'error') {
        log(`Gagal membuat socket. Coba lagi dalam ${seconds}s...${repeat}`, chalk.yellow)
        return
    }

    log(
        `Koneksi terputus (status ${statusCode ?? 'unknown'}: ${describeDisconnect(type, statusCode)}). Reconnect dalam ${seconds}s...${repeat}`,
        chalk.yellow
    )

    if (type === 'replaced') {
        log('Pastikan tidak ada instance bot lain yang memakai folder session yang sama.', chalk.yellow)
    }
}

function scheduleReconnect(statusCode, type) {
    if (reconnectTimer) return

    const options = activeOptions || {}
    let delay

    if (type === 'restart') {
        restartStreak += 1
        delay = restartStreak > FAST_RESTART_LIMIT ? RESTART_COOLDOWN_MS : 0
    } else {
        const attempt = reconnectAttempts
        reconnectAttempts += 1
        delay = options.reconnectDelay ? options.reconnectDelay(attempt, type) : reconnectDelayFor(type, attempt)
    }

    logReconnect(statusCode, type, delay)

    const scheduledGen = generation

    // sengaja tanpa unref: timer ini yang menjaga proses tetap hidup selama menunggu reconnect
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        reconnectNow(scheduledGen, type)
    }, delay)
}

async function reconnectNow(scheduledGen, type) {
    try {
        if (connectingPromise) await connectingPromise
        if (scheduledGen !== generation) return

        await flushCreds()
        if (scheduledGen !== generation) return

        if (type === 'restart') log('Menggunakan authentication state terbaru...')
        log('Menghubungkan kembali...')

        await connectToWhatsApp(activeOptions || {})
    } catch (error) {
        reportPluginError('runtime:reconnect', error, {})
        if (scheduledGen === generation) scheduleReconnect(null, 'error')
    }
}

async function ensurePlugins() {
    if (pluginsStarted) return
    pluginsStarted = true

    const init = activeOptions?.initPluginStack || initPlugins

    try {
        await init()
    } catch (error) {
        pluginsStarted = false
        reportPluginError('plugin:init', error, {})
    }
}

async function defaultCreateSocket({ auth } = {}) {
    const { state, saveCreds } = auth || (await useMultiFileAuthState(AUTH_DIR))

    if (!waVersion) {
        try {
            ({ version: waVersion } = await fetchLatestBaileysVersion())
        } catch (error) {
            reportPluginError('runtime:version', error, {})
        }
    }

    const sock = makeWASocket({
        version: waVersion || undefined,
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        logger: pino({ level: 'silent' }),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        }
    })

    return { sock, state, saveCreds }
}

function handleClose(session, lastDisconnect) {
    const statusCode = lastDisconnect?.error?.output?.statusCode
    const { type, reconnect } = classifyDisconnect(statusCode)

    endSession(session)

    if (!reconnect) {
        loggedOut = true
        lastAuth = null
        log('Sesi logout (status 401), tidak akan reconnect otomatis.', chalk.red)
        log('Hapus folder session lalu jalankan ulang bot untuk pairing ulang.', chalk.red)
        return
    }

    scheduleReconnect(statusCode, type)
}

function handleConnectionUpdate(session, { connection, lastDisconnect, qr, isNewLogin }) {
    if (session.gen !== generation || session.state === 'closed') return

    if (isNewLogin) log('Pairing berhasil, mempersiapkan restart socket...', chalk.green)

    if (connection === 'open') {
        session.state = 'open'
        reconnectAttempts = 0
        restartStreak = 0
        reconnectLog = { key: null, count: 0 }
        log('WhatsApp connected.', chalk.green)
        ensurePlugins()
        return
    }

    if (connection === 'close') {
        handleClose(session, lastDisconnect)
        return
    }

    if (connection === 'connecting' && qr && getConfig().usePairingCode === false) {
        console.log(chalk.blue('QR:'), qr)
    }
}

async function requestPairingIfNeeded(session, options) {
    if (session.auth.state.creds.registered || getConfig().usePairingCode === false) return

    try {
        const prompt = options.promptPhoneNumber || defaultPromptPhoneNumber
        const phoneNumber = await Promise.race([prompt(), session.released])

        if (session.state === 'closed') {
            closePrompt()
            return
        }

        const code = await session.sock.requestPairingCode(String(phoneNumber).trim(), 'KYYINFIN')
        console.log(chalk.blue('\nPAIRING CODE:'), code)
    } catch (error) {
        reportPluginError('runtime:pairing', error, {})
    }
}

async function startConnection(options) {
    const createSocket = options.createSocket || defaultCreateSocket
    const startGen = generation

    const { sock, state, saveCreds } = await createSocket({ auth: lastAuth })

    if (startGen !== generation) {
        cleanupSocket(sock)
        return null
    }

    const gen = ++generation
    const session = createSession(sock, gen, { state, saveCreds })

    activeSession = session
    lastAuth = session.auth
    sock.decodeJid = normalizeLid
    sock.public = true
    setResolverSocket(sock)

    sock.ev.on('creds.update', () => {
        if (gen === generation) queueSave(saveCreds)
    })

    sock.ev.on('connection.update', update => {
        handleConnectionUpdate(session, update)
    })

    sock.ev.on('messages.upsert', async ({ messages }) => {
        if (gen !== generation) return

        for (const mek of messages) {
            try {
                if (!mek?.message) continue
                if (isJidStatus(mek.key?.remoteJid)) continue
                if (mek.key?.id?.startsWith('BAE5') && mek.key.id.length === 16) continue

                const m = smsg(sock, mek)
                if (!m) continue

                await handleMessage(sock, m)
            } catch (error) {
                reportPluginError('message:upsert', error, { id: mek?.key?.id })
            }
        }
    })

    sock.ev.on('contacts.upsert', contacts => {
        captureFromContacts(contacts).catch(() => {})
    })

    sock.ev.on('contacts.update', contacts => {
        captureFromContacts(contacts).catch(() => {})
    })

    await requestPairingIfNeeded(session, options)

    return sock
}

export default async function connectToWhatsApp(options = {}) {
    if (options.createSocket !== undefined && typeof options.createSocket !== 'function') {
        throw new TypeError('createSocket harus berupa function')
    }

    activeOptions = { ...options }

    if (connectingPromise) return connectingPromise
    if (activeSession && activeSession.state !== 'closed') return activeSession.sock

    clearReconnectTimer()
    loggedOut = false

    const startGen = generation

    connectingPromise = startConnection(activeOptions).catch(error => {
        reportPluginError('runtime:connect', error, {})
        if (startGen === generation) scheduleReconnect(null, 'error')
        return null
    })

    try {
        return await connectingPromise
    } finally {
        connectingPromise = null
    }
}
