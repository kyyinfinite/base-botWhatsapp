import { DisconnectReason } from '@whiskeysockets/baileys'

export const RECONNECT_BASE_MS = 2000
export const RECONNECT_MAX_MS = 60000
export const REPLACED_BASE_MS = 30000
export const REPLACED_MAX_MS = 300000
export const REPLACED_JITTER_MS = 5000

export function computeBackoff(attempt, { base = RECONNECT_BASE_MS, max = RECONNECT_MAX_MS, jitter = 500 } = {}) {
    const n = Math.max(0, Math.floor(Number(attempt) || 0))
    const exponential = Math.min(max, base * 2 ** n)
    return exponential + Math.floor(Math.random() * jitter)
}

export function classifyDisconnect(statusCode) {
    switch (statusCode) {
        case DisconnectReason.restartRequired:
            return { type: 'restart', reconnect: true }
        case DisconnectReason.loggedOut:
            return { type: 'logout', reconnect: false }
        case DisconnectReason.forbidden:
            return { type: 'forbidden', reconnect: false }
        case DisconnectReason.multideviceMismatch:
            return { type: 'multideviceMismatch', reconnect: false }
        case DisconnectReason.badSession:
            return { type: 'badSession', reconnect: true }
        case DisconnectReason.connectionReplaced:
            return { type: 'replaced', reconnect: true }
        case DisconnectReason.connectionClosed:
        case DisconnectReason.connectionLost:
        case DisconnectReason.unavailableService:
            return { type: 'transient', reconnect: true }
        default:
            return { type: 'unknown', reconnect: true }
    }
}

export function shouldReconnect(statusCode) {
    return classifyDisconnect(statusCode).reconnect
}

export function reconnectDelayFor(type, attempt) {
    if (type === 'restart') return 0
    if (type === 'replaced') {
        return computeBackoff(attempt, { base: REPLACED_BASE_MS, max: REPLACED_MAX_MS, jitter: REPLACED_JITTER_MS })
    }
    return computeBackoff(attempt)
}

export function describeDisconnect(type, statusCode) {
    switch (type) {
        case 'restart':
            return 'restart socket diminta WhatsApp'
        case 'logout':
            return 'sesi logout, kredensial tidak berlaku lagi'
        case 'badSession':
            return 'sesi tidak valid, bila berulang hapus folder session lalu pairing ulang'
        case 'forbidden':
            return 'akses ditolak WhatsApp'
        case 'multideviceMismatch':
            return 'registrasi multidevice tidak cocok, perlu pairing ulang'
        case 'replaced':
            return 'sesi dipakai perangkat/proses lain'
        case 'transient':
            return statusCode === DisconnectReason.unavailableService
                ? 'layanan WhatsApp sedang tidak tersedia'
                : 'koneksi terputus'
        case 'error':
            return 'gagal membuat socket'
        default:
            return 'penyebab tidak diketahui'
    }
}
