import { test, describe, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'

const tmpOb = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-ob-'))
process.env.WA_DATABASE_DIR = tmpOb
process.env.WA_OWNER_PATH = path.join(tmpOb, 'owner.json')
process.env.WA_PREMIUM_PATH = path.join(tmpOb, 'premium.json')
process.env.WA_CONFIG_PATH = path.join(tmpOb, 'config.json')
fs.writeFileSync(process.env.WA_CONFIG_PATH, JSON.stringify({ botMode: 'public', prefix: ['.'], dailyLimit: 5, creator: [] }))

const logger = await import('../src/services/logger.js')
const errorsEngine = await import('../src/core/errors/engine.js')
const health = await import('../src/services/health.js')
const { events } = await import('../src/core/events/engine.js')

after(() => {
    fs.rmSync(tmpOb, { recursive: true, force: true })
})

describe('structured logger', () => {
    beforeEach(() => logger.clearLogs())

    test('entri log punya struktur lengkap', () => {
        const entry = logger.logInfo('runtime', 'connection.open', { user: '628000@s.whatsapp.net' })

        assert.equal(entry.level, 'info')
        assert.equal(entry.subsystem, 'runtime')
        assert.equal(entry.event, 'connection.open')
        assert.equal(typeof entry.ts, 'number')
        assert.equal(entry.data.user, '628000@s.whatsapp.net')
    })

    test('level tidak valid jatuh ke info dan filter level bekerja', () => {
        logger.logWarn('queue', 'overflow', {})
        logger.logError('error-engine', 'plugin.error', {})
        logger.logInfo('runtime', 'tick', {})
        logger.logStructured('bukan-level', 'x', 'y', {})

        assert.equal(logger.getRecentLogs({ level: 'warn' }).length, 2)
        assert.equal(logger.getRecentLogs({ level: 'error' }).length, 1)
        assert.equal(logger.getRecentLogs({}).length, 4)
    })

    test('filter subsystem bekerja', () => {
        logger.logInfo('runtime', 'a', {})
        logger.logInfo('queue', 'b', {})

        const onlyRuntime = logger.getRecentLogs({ subsystem: 'runtime' })
        assert.equal(onlyRuntime.length, 1)
        assert.equal(onlyRuntime[0].event, 'a')
    })

    test('data disanitasi: error jadi pesan, string panjang terpotong', () => {
        const entry = logger.logError('x', 'y', {
            error: new Error('rahasia-stack'),
            long: 'a'.repeat(2000)
        })

        assert.equal(entry.data.error.message, 'rahasia-stack')
        assert.ok(entry.data.long.length <= 501)
    })

    test('ring buffer terbatas: entri terlama dibuang', () => {
        const { max } = logger.getLogStats()
        for (let i = 0; i < max + 50; i++) {
            logger.logDebug('burst', `e${i}`, { i })
        }

        const stats = logger.getLogStats()
        assert.equal(stats.entries, max)
        const recent = logger.getRecentLogs({ subsystem: 'burst', limit: 1 })
        assert.equal(recent[0].event, `e${max + 49}`, 'entri terakhir tetap ada')
    })

    test('level rendah tidak masuk filter warn tanpa menghilangkan entri lain', () => {
        logger.logDebug('z', 'd', {})
        assert.equal(logger.getRecentLogs({ level: 'warn' }).length, 0)
        assert.equal(logger.getRecentLogs({}).length, 1)
    })
})

describe('integrasi error engine → logger', () => {
    beforeEach(() => logger.clearLogs())

    test('reportPluginError merekam log terstruktur dan emit event', () => {
        const received = []
        const handler = payload => received.push(payload)
        events.on('bot:error', handler)

        try {
            const returned = errorsEngine.reportPluginError('test:scope', new Error('ledak'), { id: 'X1' })

            assert.ok(returned instanceof Error)
            assert.equal(received.length, 1)
            assert.equal(received[0].scope, 'test:scope')

            const logs = logger.getRecentLogs({ subsystem: 'error-engine' })
            assert.equal(logs.length, 1)
            assert.equal(logs[0].data.scope, 'test:scope')
            assert.equal(logs[0].data.message, 'ledak')
        } finally {
            events.off('bot:error', handler)
        }
    })

    test('non-Error diubah menjadi Error', () => {
        errorsEngine.reportPluginError('test:string', 'bukan error')
        const logs = logger.getRecentLogs({ subsystem: 'error-engine' })
        assert.equal(logs.at(-1).data.message, 'bukan error')
    })
})

describe('runtime health & diagnostic report', () => {
    test('getRuntimeHealth memuat semua subsistem', () => {
        const healthData = health.getRuntimeHealth()

        assert.equal(typeof healthData.ts, 'number')
        assert.ok(healthData.uptimeSec >= 0)
        assert.equal(healthData.connection.state, 'closed')
        assert.ok(Number.isFinite(healthData.queue.keys))
        assert.ok(Number.isFinite(healthData.identity.pnCount))
        assert.ok(Number.isFinite(healthData.groupCache.entries))
        assert.ok(Number.isFinite(healthData.messageStore.entries))
        assert.ok(Number.isFinite(healthData.conversation.entries))
        assert.ok(Number.isFinite(healthData.scheduler.jobs))
        assert.ok(healthData.process.memory.rssMb > 0)
    })

    test('formatDiagnosticReport menghasilkan laporan teks utuh', () => {
        logger.logWarn('runtime', 'contoh.peringatan', { kode: 7 })
        const report = health.formatDiagnosticReport({ logLimit: 10 })

        assert.ok(report.includes('=== DIAGNOSTIC REPORT'))
        assert.ok(report.includes('connection:'))
        assert.ok(report.includes('queue:'))
        assert.ok(report.includes('memory:'))
        assert.ok(report.includes('contoh.peringatan'))
    })

    test('laporan tidak membocorkan stack error', () => {
        errorsEngine.reportPluginError('test:leak', new Error('pesan saja'))
        const report = health.formatDiagnosticReport({ logLimit: 50 })

        assert.ok(report.includes('pesan saja'))
        assert.ok(!report.includes('at TestContext'))
    })
})
