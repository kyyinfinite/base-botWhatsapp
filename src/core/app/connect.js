import readline from 'readline'
import pino from 'pino'
import chalk from 'chalk'

import {
    useMultiFileAuthState,
    DisconnectReason,
    jidDecode,
    makeCacheableSignalKeyStore,
    fetchLatestBaileysVersion,
    makeWASocket
} from '@whiskeysockets/baileys'

import { smsg } from '../../utils/myfunc.js'
import handleMessage, { initPlugins } from '../handler/handler.js'

const usePairingCode = true

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
})

const question = (text) =>
    new Promise(resolve => rl.question(text, resolve))

let pluginsLoaded = false

export default async function connectToWhatsApp() {
    const { state, saveCreds } =
        await useMultiFileAuthState('./session')

    const { version } =
        await fetchLatestBaileysVersion()

    const sock = makeWASocket({
        version,

        printQRInTerminal: !usePairingCode,

        browser: [
            'Ubuntu',
            'Chrome',
            '20.0.04'
        ],

        logger: pino({
            level: 'silent'
        }),

        auth: {
            creds: state.creds,

            keys: makeCacheableSignalKeyStore(
                state.keys,
                pino({ level: 'silent' })
            )
        }
    })

    sock.decodeJid = (jid) => {
        if (!jid) return jid

        if (/:\d+@/gi.test(jid)) {
            const decode = jidDecode(jid) || {}

            return decode.user && decode.server
                ? `${decode.user}@${decode.server}`
                : jid
        }

        return jid
    }

    // Pairing Code
    if (!sock.authState?.creds?.registered && usePairingCode) {
        const phoneNumber = await question(`
Silahkan masukkan nomor (628xxx):
`)

        const code = await sock.requestPairingCode(
            phoneNumber.trim(),
            'KYYINFIN'
        )

        console.log(
            chalk.blue('\nPAIRING CODE:'),
            code
        )
    }

    // Message Handler
    sock.ev.on('messages.upsert', async ({ messages }) => {
        try {
            for (const mek of messages) {
                if (!mek?.message) continue

                if (
                    mek.key?.remoteJid === 'status@broadcast'
                ) continue

                if (
                    mek.key?.id?.startsWith('BAE5') &&
                    mek.key.id.length === 16
                ) continue

                const m = smsg(sock, mek)

                if (!m) continue

                await handleMessage(sock, m)
            }
        } catch (error) {
            console.error(error)
        }
    })

    sock.public = true

    // Connection
    sock.ev.on(
        'connection.update',
        async ({ connection, lastDisconnect }) => {

            if (connection === 'open') {
                console.log(
                    chalk.green(
                        '✓ WhatsApp connected'
                    )
                )

                if (!pluginsLoaded) {
                    await initPlugins()
                    pluginsLoaded = true
                }

                return
            }

            if (connection === 'close') {
                const statusCode =
                    lastDisconnect?.error?.output?.statusCode

                if (
                    statusCode !==
                    DisconnectReason.loggedOut
                ) {
                    console.log(
                        chalk.yellow(
                            'Connection closed. Reconnecting...'
                        )
                    )

                    connectToWhatsApp()
                } else {
                    console.log(
                        chalk.red(
                            'Logged out. Please pair again.'
                        )
                    )
                }
            }
        }
    )

    // Save authentication credentials
    sock.ev.on(
        'creds.update',
        saveCreds
    )

    return sock
}