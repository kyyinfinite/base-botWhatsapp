const cooldowns = new Map()

const SWEEP_INTERVAL_MS = 60_000
const SWEEP_THRESHOLD = 500
let lastSweep = 0

function sweep(now) {
    for (const [key, expiresAt] of cooldowns) {
        if (expiresAt <= now) cooldowns.delete(key)
    }
}

export function getCooldownKey(ctx, handler) {
    const identity = ctx.identityKey || ctx.sender || 'unknown'
    const chat = ctx.chatKey || ctx.chat || 'unknown'
    const command = ctx.command || handler.command?.toString?.() || 'custom'
    return `${identity}:${chat}:${command}`
}

export function checkCooldown(key) {
    const now = Date.now()

    if (now - lastSweep > SWEEP_INTERVAL_MS || cooldowns.size >= SWEEP_THRESHOLD) {
        sweep(now)
        lastSweep = now
    }

    const expiresAt = cooldowns.get(key) || 0
    if (expiresAt > now) {
        return { active: true, remainingMs: expiresAt - now }
    }
    return { active: false, remainingMs: 0 }
}

export function commitCooldown(key, duration) {
    const now = Date.now()
    const expiresAt = cooldowns.get(key) || 0
    if (expiresAt > now) return false
    cooldowns.set(key, now + duration)
    return true
}

export function releaseCooldown(key) {
    cooldowns.delete(key)
}

export async function cooldownMiddleware(ctx, handler) {
    const duration = Number(handler.cooldown || 0)
    if (!Number.isFinite(duration) || duration <= 0) return null

    const key = getCooldownKey(ctx, handler)
    const state = checkCooldown(key)

    if (state.active) {
        const seconds = Math.max(1, Math.ceil(state.remainingMs / 1000))
        return {
            allowed: false,
            title: 'Cooldown',
            message: `Tunggu ${seconds} detik sebelum menggunakan perintah ini lagi.`
        }
    }

    if (!commitCooldown(key, duration)) {
        return {
            allowed: false,
            title: 'Cooldown',
            message: 'Tunggu sebentar sebelum menggunakan perintah ini lagi.'
        }
    }

    ctx._cooldownRelease = () => releaseCooldown(key)
    return null
}

export function clearCooldowns() {
    cooldowns.clear()
}
