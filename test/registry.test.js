import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const {
    plugins,
    metadata,
    registerPlugin,
    unregisterPlugin,
    replacePlugin,
    validatePlugin,
    getPatternPlugins,
    getKeysOf
} = await import('../src/core/plugin/registry.js')

const makeHandler = (command, extra = {}) => {
    const handler = async () => {}
    if (command !== undefined) handler.command = command
    Object.assign(handler, extra)
    return handler
}

describe('plugin registry', () => {
    beforeEach(() => {
        for (const file of [...metadata.keys()]) {
            unregisterPlugin(file, getKeysOf(file))
        }
    })

    test('menolak handler yang bukan fungsi', () => {
        assert.throws(() => registerPlugin('a', null), TypeError)
        assert.throws(() => registerPlugin('a', 'bukan-fungsi'), TypeError)
    })

    test('menolak plugin tanpa command dan customPrefix', () => {
        assert.throws(() => registerPlugin('a', async () => {}), /command|customPrefix/i)
    })

    test('menolak metadata dengan tipe salah', () => {
        assert.throws(() => registerPlugin('a', makeHandler('x', { cooldown: 'lima' })), TypeError)
        assert.throws(() => registerPlugin('a', makeHandler('x', { owner: 'ya' })), TypeError)
        assert.throws(() => registerPlugin('a', makeHandler('x', { customPrefix: '.abc' })), TypeError)
        assert.throws(() => registerPlugin('a', makeHandler(['x', 123])), TypeError)
    })

    test('menerima metadata yang valid', () => {
        assert.equal(validatePlugin(makeHandler('x', { cooldown: 5, limit: true, customPrefix: /^a/ })), true)
    })

    test('menolak customPrefix dengan flag g atau y', () => {
        assert.throws(() => registerPlugin('a', makeHandler('x', { customPrefix: /abc/g })), /customPrefix.*flag|flag/i)
        assert.throws(() => registerPlugin('a', makeHandler('x', { customPrefix: /abc/y })), /customPrefix.*flag|flag/i)
        assert.throws(() => registerPlugin('a', makeHandler('x', { customPrefix: new RegExp('abc', 'gi') })), TypeError)
        assert.equal(validatePlugin(makeHandler('x', { customPrefix: /abc/i })), true)
    })

    test('command string dan array terdaftar dengan benar', () => {
        registerPlugin('a', makeHandler(['menu', 'Menu']))
        registerPlugin('b', makeHandler('ping'))
        assert.ok(plugins.get('menu'))
        assert.ok(plugins.get('ping'))
        assert.deepEqual(metadata.get('a').commands, ['menu'])
    })

    test('collision: owner pertama dipertahankan', () => {
        const first = makeHandler('shared')
        const second = makeHandler('shared')
        registerPlugin('file-a', first)
        registerPlugin('file-b', second)

        assert.equal(plugins.get('shared'), first)
        assert.deepEqual(metadata.get('file-b').commands, [])
    })

    test('ownership tidak terhapus saat unregister file lain', () => {
        const a = makeHandler(['cmda'])
        const b = makeHandler(['cmdb'])
        registerPlugin('file-a', a)
        registerPlugin('file-b', b)

        unregisterPlugin('file-a', getKeysOf('file-a'))

        assert.ok(plugins.get('cmdb'))
        assert.equal(plugins.get('cmda'), undefined)
    })

    test('command kosong setelah unregister bisa dipakai file lain', () => {
        registerPlugin('file-a', makeHandler('free-cmd'))
        unregisterPlugin('file-a', getKeysOf('file-a'))
        registerPlugin('file-b', makeHandler('free-cmd'))
        assert.ok(plugins.get('free-cmd'))
    })

    test('regex command didaftarkan sebagai pattern plugin', () => {
        const handler = makeHandler(/^halo-.*/)
        registerPlugin('regex-file', handler)
        assert.ok(getPatternPlugins().includes(handler))
        assert.equal(metadata.get('regex-file').commands.length, 0)
    })

    test('customPrefix didaftarkan sebagai pattern plugin', () => {
        const handler = makeHandler(undefined, { customPrefix: /^\$/ })
        registerPlugin('prefix-file', handler)
        assert.ok(getPatternPlugins().includes(handler))
    })

    test('replacePlugin mengganti command milik file yang sama', () => {
        registerPlugin('file-x', makeHandler(['old1', 'old2']))
        const next = makeHandler(['new1'])
        const keys = replacePlugin('file-x', getKeysOf('file-x'), next)

        assert.equal(plugins.get('old1'), undefined)
        assert.equal(plugins.get('old2'), undefined)
        assert.equal(plugins.get('new1'), next)
        assert.deepEqual(keys, ['new1'])
        assert.deepEqual(metadata.get('file-x').commands, ['new1'])
    })

    test('replacePlugin gagal validasi tidak menghapus plugin lama', () => {
        const old = makeHandler(['keep-me'])
        registerPlugin('file-y', old)
        const oldKeys = getKeysOf('file-y')

        assert.throws(() => replacePlugin('file-y', oldKeys, makeHandler(['ok', { bad: true }])), TypeError)

        assert.equal(plugins.get('keep-me'), old)
    })

    test('replacePlugin gagal validasi tetap mempertahankan metadata lama', () => {
        const old = makeHandler(['keep-meta'], { help: ['keep'], tags: ['utama'] })
        registerPlugin('file-meta', old)
        const oldKeys = getKeysOf('file-meta')

        assert.throws(() => replacePlugin('file-meta', oldKeys, makeHandler('bad', { cooldown: 'lima' })), TypeError)

        assert.equal(plugins.get('keep-meta'), old)
        assert.ok(metadata.get('file-meta'), 'metadata tidak boleh hilang saat rollback')
        assert.deepEqual(metadata.get('file-meta').commands, ['keep-meta'])
        assert.deepEqual(metadata.get('file-meta').help, ['keep'])
    })

    test('replacePlugin validasi baru gagal sebelum plugin lama disentuh', () => {
        const old = makeHandler(['stable'])
        registerPlugin('file-atomic', old)

        assert.throws(() => replacePlugin('file-atomic', getKeysOf('file-atomic'), makeHandler('x', { owner: 'yes' })), TypeError)

        assert.equal(plugins.get('stable'), old)
        assert.ok(metadata.get('file-atomic'))
    })

    test('replacePlugin tidak menghapus command plugin lain saat collision', () => {
        const keeper = makeHandler(['shared-cmd'])
        registerPlugin('file-keeper', keeper)
        registerPlugin('file-replacer', makeHandler(['own-cmd']))

        const next = makeHandler(['own-cmd', 'shared-cmd', 'fresh-cmd'])
        replacePlugin('file-replacer', getKeysOf('file-replacer'), next)

        assert.equal(plugins.get('shared-cmd'), keeper, 'command milik file lain tetap utuh')
        assert.equal(plugins.get('own-cmd'), next)
        assert.equal(plugins.get('fresh-cmd'), next)
        assert.deepEqual(metadata.get('file-replacer').commands, ['own-cmd', 'fresh-cmd'])
    })

    test('unregister dengan keys basi tidak menghapus command plugin lain', () => {
        const a = makeHandler(['victim'])
        registerPlugin('file-owner-a', a)
        registerPlugin('file-owner-b', makeHandler(['other']))

        const staleKeys = getKeysOf('file-owner-a')
        unregisterPlugin('file-owner-b', staleKeys)

        assert.equal(plugins.get('victim'), a, 'ownership diverifikasi sebelum penghapusan')
        assert.ok(metadata.get('file-owner-a'), 'metadata pemilik asli tetap')
    })

    test('unregister dengan keys milik file lain tidak menghapus ownership', () => {
        registerPlugin('file-real', makeHandler(['real-cmd']))
        registerPlugin('file-ghost', makeHandler(['ghost-cmd']))

        unregisterPlugin('file-ghost', ['real-cmd'])

        assert.ok(plugins.get('real-cmd'), 'command tetap terdaftar')
        assert.ok(metadata.get('file-real'))
    })

    test('rollback replacePlugin memulihkan seluruh command lama', () => {
        const old = makeHandler(['alpha', 'beta'])
        registerPlugin('file-rollback', old)
        const oldKeys = getKeysOf('file-rollback')

        assert.throws(() => replacePlugin('file-rollback', oldKeys, makeHandler(['x', 123])), TypeError)

        assert.equal(plugins.get('alpha'), old)
        assert.equal(plugins.get('beta'), old)
        assert.deepEqual(metadata.get('file-rollback').commands, ['alpha', 'beta'])
    })

    test('metadata dan registry tetap sinkron setelah siklus lengkap', () => {
        registerPlugin('file-sync', makeHandler(['sync-a']))
        replacePlugin('file-sync', getKeysOf('file-sync'), makeHandler(['sync-b']))
        unregisterPlugin('file-sync', getKeysOf('file-sync'))

        assert.equal(metadata.get('file-sync'), undefined, 'metadata hilang setelah unregister')
        assert.equal(plugins.get('sync-b'), undefined)

        for (const [file, meta] of metadata.entries()) {
            const keys = getKeysOf(file)
            for (const cmd of meta.commands) {
                assert.ok(keys.includes(cmd), `command ${cmd} milik ${file} harus konsisten dengan registry`)
            }
        }
    })

    test('getKeysOf mengembalikan command dan pattern milik file', () => {
        const handler = makeHandler(['duo'], { customPrefix: /^duo/ })
        registerPlugin('file-z', handler)
        const keys = getKeysOf('file-z')
        assert.equal(keys.length, 2)
        assert.equal(keys.filter(k => typeof k === 'string').length, 1)
        assert.equal(keys.filter(k => typeof k === 'symbol').length, 1)
    })
})
