import { getConnectionStatus } from '../core/app/connect.js'
import { queueStats } from '../core/queue/engine.js'
import { getResolverStats } from './identity-resolver.js'
import { getGroupCacheStats } from './group-cache.js'
import { getMessageStoreStats } from './message-store.js'
import { getConversationStats } from './conversation-state.js'
import { listScheduledJobs } from './scheduler.js'
import { getLogStats, getRecentLogs } from './logger.js'

export function getRuntimeHealth() {
    const memory = process.memoryUsage()

    return {
        ts: Date.now(),
        uptimeSec: Math.floor(process.uptime()),
        connection: getConnectionStatus(),
        queue: queueStats(),
        identity: getResolverStats(),
        groupCache: getGroupCacheStats(),
        messageStore: getMessageStoreStats(),
        conversation: getConversationStats(),
        scheduler: { jobs: listScheduledJobs().length },
        logs: getLogStats(),
        process: {
            pid: process.pid,
            nodeVersion: process.version,
            memory: {
                rssMb: Math.round(memory.rss / 1024 / 1024),
                heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
                heapTotalMb: Math.round(memory.heapTotal / 1024 / 1024),
                externalMb: Math.round(memory.external / 1024 / 1024)
            }
        }
    }
}

export function formatDiagnosticReport({ logLimit = 30 } = {}) {
    const health = getRuntimeHealth()
    const logs = getRecentLogs({ limit: logLimit })

    const lines = [
        `=== DIAGNOSTIC REPORT (${new Date(health.ts).toISOString()}) ===`,
        `uptime: ${health.uptimeSec}s | pid: ${health.process.pid} | node: ${health.process.nodeVersion}`,
        `connection: state=${health.connection.state} loggedOut=${health.connection.loggedOut} reconnectScheduled=${health.connection.reconnectScheduled} attempts=${health.connection.attempts}`,
        `queue: keys=${health.queue.keys} pending=${health.queue.pending}`,
        `identity: pn=${health.identity.pnCount} lid=${health.identity.lidCount} negative=${health.identity.negativeCount}`,
        `groupCache: ${health.groupCache.entries}/${health.groupCache.max} (ttl ${health.groupCache.ttlMs}ms)`,
        `messageStore: ${health.messageStore.entries}/${health.messageStore.max}`,
        `conversation: ${health.conversation.entries}/${health.conversation.max}`,
        `scheduler: ${health.scheduler.jobs} job(s)`,
        `logs: ${JSON.stringify(health.logs.byLevel)} (${health.logs.entries}/${health.logs.max})`,
        `memory: rss=${health.process.memory.rssMb}MB heap=${health.process.memory.heapUsedMb}/${health.process.memory.heapTotalMb}MB external=${health.process.memory.externalMb}MB`,
        `--- log terakhir (${logs.length}) ---`
    ]

    for (const entry of logs) {
        lines.push(`[${new Date(entry.ts).toISOString()}] ${entry.level.toUpperCase()} ${entry.subsystem} ${entry.event} ${JSON.stringify(entry.data)}`)
    }

    return lines.join('\n')
}
