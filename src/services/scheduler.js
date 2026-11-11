import { schedules } from './database/json.js'

const running = new Set()
const jobs = new Map()
const attempts = new Map()

const MAX_ATTEMPTS = 3
const RETRY_DELAY_MS = 30_000
const TICK_MS = 30_000

let ticker = null
let sender = null

const isFuture = ms => Number.isFinite(ms) && ms > Date.now()

function validateJob({ id, chatJid, content, at, every }) {
    if (typeof id !== 'string' || !id.trim()) throw new TypeError('id harus string non-kosong')
    if (typeof chatJid !== 'string' || !chatJid.trim()) throw new TypeError('chatJid harus string non-kosong')
    if (!content || typeof content !== 'object') throw new TypeError('content harus berupa object')

    const hasAt = Number.isFinite(Number(at))
    const hasEvery = Number.isFinite(Number(every)) && Number(every) >= 1000
    if (!hasAt && !hasEvery) {
        throw new TypeError('butuh `at` (epoch ms) atau `every` (ms, >= 1000)')
    }

    return {
        id: id.trim(),
        chatJid,
        content,
        at: hasAt ? Number(at) : null,
        every: hasEvery ? Number(every) : null
    }
}

function persistJob(job) {
    schedules.set(job.id, { ...job, lastRunAt: job.lastRunAt ?? null, runCount: job.runCount ?? 0 })
}

function removeJob(id) {
    jobs.delete(id)
    attempts.delete(id)
    try {
        schedules.delete(id)
    } catch {}
}

function isDue(job, now) {
    if (job.every) {
        return job.lastRunAt === undefined || job.lastRunAt === null || now - job.lastRunAt >= job.every
    }
    return job.at !== null && now >= job.at
}

async function runJob(job, now) {
    if (running.has(job.id)) return
    running.add(job.id)

    try {
        await sender(job.chatJid, job.content, job)
        job.runCount = (job.runCount ?? 0) + 1
        job.lastRunAt = now
        attempts.delete(job.id)

        if (job.every) {
            persistJob(job)
        } else {
            removeJob(job.id)
        }
    } catch (error) {
        const count = (attempts.get(job.id) || 0) + 1
        attempts.set(job.id, count)

        if (job.every) {
            persistJob(job)
            if (count < MAX_ATTEMPTS) job.lastRunAt = now - job.every + RETRY_DELAY_MS
        } else if (count < MAX_ATTEMPTS) {
            job.at = Date.now() + RETRY_DELAY_MS
            persistJob(job)
        } else {
            removeJob(job.id)
        }

        onError?.(error, { id: job.id, attempt: count })
    } finally {
        running.delete(job.id)
    }
}

function onError(error, info) {
    console.error(`[SCHEDULER] Gagal menjalankan job ${info.id} (percobaan ${info.attempt}):`, error.message)
}

async function tick() {
    if (!sender) return
    const now = Date.now()
    for (const job of [...jobs.values()]) {
        if (isDue(job, now)) await runJob(job, now)
    }
}

export function addScheduledJob(input) {
    const job = validateJob(input)

    jobs.delete(job.id)
    jobs.set(job.id, job)
    persistJob(job)
    return job
}

export function cancelScheduledJob(id) {
    const existed = jobs.has(id) || schedules.get(id)
    removeJob(id)
    return !!existed
}

export function listScheduledJobs() {
    return [...jobs.values()].map(job => ({ ...job }))
}

export async function startScheduler({ sender: sendFn } = {}) {
    if (typeof sendFn !== 'function') throw new TypeError('sender harus function')

    sender = sendFn

    try {
        const stored = schedules.all()
        for (const record of Object.values(stored)) {
            if (!record?.id || jobs.has(record.id)) continue
            jobs.set(record.id, { ...record })
        }
    } catch {}

    if (!ticker) {
        ticker = setInterval(() => {
            tick().catch(() => {})
        }, TICK_MS)
        ticker.unref?.()
    }

    return jobs.size
}

export async function stopScheduler() {
    if (ticker) {
        clearInterval(ticker)
        ticker = null
    }
    sender = null
    running.clear()
}

export function resetSchedulerState() {
    if (ticker) {
        clearInterval(ticker)
        ticker = null
    }
    jobs.clear()
    attempts.clear()
    running.clear()
    sender = null
    try {
        schedules.setAll({})
    } catch {}
}
