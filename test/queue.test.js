import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { messageQueue, queueStats } from '../src/core/queue/engine.js'

describe('message queue', () => {
    test('urutan antar pesan satu chat terjaga', async () => {
        const order = []
        const tasks = []
        for (let i = 0; i < 5; i++) {
            tasks.push(messageQueue.add('order-a', async () => {
                await new Promise(r => setTimeout(r, (i % 3) * 5))
                order.push(i)
            }))
        }
        await Promise.all(tasks)
        assert.deepEqual(order, [0, 1, 2, 3, 4])
    })

    test('chat berbeda diproses paralel', async () => {
        let running = 0
        let maxRunning = 0

        const task = async () => {
            running += 1
            maxRunning = Math.max(maxRunning, running)
            await new Promise(r => setTimeout(r, 20))
            running -= 1
        }

        await Promise.all([
            messageQueue.add('par-1', task),
            messageQueue.add('par-2', task),
            messageQueue.add('par-3', task)
        ])

        assert.equal(maxRunning, 3)
    })

    test('kegagalan satu pesan tidak menghentikan pesan berikutnya', async () => {
        const calls = []
        await assert.rejects(
            () => messageQueue.add('fail-key', async () => { throw new Error('boom') }),
            /boom/
        )
        await messageQueue.add('fail-key', async () => { calls.push('after') })
        assert.deepEqual(calls, ['after'])
    })

    test('overflow melempar error eksplisit tanpa menghentikan antrian', async () => {
        let release
        const gate = new Promise(r => { release = r })

        const first = messageQueue.add('overflow-key', () => gate)
        const pending = []
        for (let i = 0; i < 49; i++) {
            pending.push(messageQueue.add('overflow-key', async () => {}))
        }

        await assert.rejects(
            () => messageQueue.add('overflow-key', async () => {}),
            /overflow/i
        )

        release()
        await first
        await Promise.all(pending)

        await messageQueue.add('overflow-key', async () => {})
    })

    test('statistik antrian kosong setelah semua selesai', async () => {
        await messageQueue.add('stats-key', async () => {})
        await new Promise(r => setImmediate(r))
        await new Promise(r => setImmediate(r))
        assert.equal(queueStats().keys, 0)
        assert.equal(queueStats().pending, 0)
    })
})
