const queues = new Map()
const MAX_PENDING_PER_KEY = 50

class MessageQueue {
    async add(key, task) {
        const queueKey = String(key || 'global')
        const current = queues.get(queueKey)
        if (current && current.pending >= MAX_PENDING_PER_KEY) {
            throw new Error(`Message queue overflow for ${queueKey}`)
        }

        const state = current || { tail: Promise.resolve(), pending: 0 }
        state.pending += 1
        queues.set(queueKey, state)

        const run = state.tail.then(task, task)
        state.tail = run.catch(() => undefined)

        try {
            return await run
        } finally {
            state.pending -= 1
            if (state.pending === 0) queues.delete(queueKey)
        }
    }
}

export const messageQueue = new MessageQueue()
export const queueStats = () => ({ keys: queues.size, pending: [...queues.values()].reduce((n, q) => n + q.pending, 0) })
