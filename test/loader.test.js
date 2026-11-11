import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-plugins-'))

const PLUGIN_V1 = `
let handler = async () => 'v1'
handler.command = ['hotcmd']
export default handler
`

const PLUGIN_V2 = `
let handler = async () => 'v2'
handler.command = ['hotcmd', 'extracmd']
export default handler
`

const PLUGIN_INVALID = `
let handler = async () => 'broken'
handler.command = 42
export default handler
`

const PLUGIN_NO_DEFAULT = `
export const something = 1
`

const PLUGIN_SYNTAX_ERROR = `
let handler = async () => {
export default handler
`

const { plugins, unregisterPlugin, getKeysOf, metadata } = await import('../src/core/plugin/registry.js')
const { loadPlugin, unloadPlugin, getPluginFiles, initPlugins, stopWatching } = await import('../src/core/plugin/loader.js')

const v1Path = path.join(tmp, 'v1.js')
const deepPath = path.join(tmp, 'nested', 'deep.js')

describe('plugin loader', () => {
    before(async () => {
        fs.mkdirSync(path.join(tmp, 'nested'), { recursive: true })
        fs.writeFileSync(v1Path, PLUGIN_V1)
        fs.writeFileSync(path.join(tmp, 'empty.js'), PLUGIN_NO_DEFAULT)
        fs.writeFileSync(deepPath, "let handler = async () => {}\nhandler.command = ['deepcmd']\nexport default handler\n")
        await loadPlugin(deepPath)
    })

    after(() => {
        stopWatching()
        for (const file of [...metadata.keys()]) {
            unregisterPlugin(file, getKeysOf(file))
        }
        fs.rmSync(tmp, { recursive: true, force: true })
    })

    test('getPluginFiles menemukan file nested', () => {
        const files = getPluginFiles(tmp)
        assert.equal(files.length, 3)
        assert.ok(files.some(f => f.endsWith('deep.js')))
    })

    test('loadPlugin mendaftarkan command', async () => {
        const handler = await loadPlugin(v1Path)
        assert.ok(handler)
        assert.ok(plugins.get('hotcmd'))
        assert.equal(await handler({}, {}), 'v1')
    })

    test('loadPlugin pada file tanpa default export diabaikan', async () => {
        const result = await loadPlugin(path.join(tmp, 'empty.js'))
        assert.equal(result, null)
    })
    test('loadPlugin pada file sintaks error tidak melempar dan tidak mendaftar', async () => {
        const badPath = path.join(tmp, 'bad.js')
        fs.writeFileSync(badPath, PLUGIN_SYNTAX_ERROR)
        const result = await loadPlugin(badPath)
        assert.equal(result, null)
    })

    test('hot reload: file baru menggantikan command lama', async () => {
        fs.writeFileSync(v1Path, PLUGIN_V2)
        const handler = await loadPlugin(v1Path)
        assert.equal(await handler({}, {}), 'v2')
        assert.ok(plugins.get('extracmd'))
        assert.ok(plugins.get('hotcmd'))
    })

    test('plugin rusak saat reload tidak menghapus plugin lama yang jalan', async () => {
        fs.writeFileSync(v1Path, PLUGIN_INVALID)
        const result = await loadPlugin(v1Path)
        assert.equal(result, null)

        assert.ok(plugins.get('hotcmd'), 'plugin lama harus masih terdaftar')
        assert.ok(plugins.get('extracmd'), 'plugin lama harus masih terdaftar')
    })

    test('plugin valid lagi bisa di-reload setelah gagal', async () => {
        fs.writeFileSync(v1Path, PLUGIN_V1)
        const handler = await loadPlugin(v1Path)
        assert.equal(await handler({}, {}), 'v1')
        assert.equal(plugins.get('extracmd'), undefined)
    })

    test('unloadPlugin menghapus command milik file itu saja', async () => {
        assert.equal(await unloadPlugin(v1Path), true)
        assert.equal(plugins.get('hotcmd'), undefined)
        assert.ok(plugins.get('deepcmd'))
    })

    test('unloadPlugin pada file tidak dikenal mengembalikan false', async () => {
        assert.equal(await unloadPlugin('/tidak/ada.js'), false)
    })
})

describe('plugin asli repository', () => {
    const realPluginDir = path.resolve(__dirname, '../plugins')

    test('seluruh plugin asli valid dan terdaftar', async () => {
        const files = getPluginFiles(realPluginDir)
        assert.ok(files.length >= 10, `ditemukan ${files.length} plugin, minimal 10 diharapkan`)

        for (const file of files) {
            const handler = await loadPlugin(file)
            assert.ok(handler, `${file} gagal dimuat`)
        }

        const registered = [...plugins.keys()].filter(key => typeof key === 'string')
        assert.ok(registered.length >= 10, 'command plugin asli harus terdaftar')
    })

    test('seluruh plugin asli memakai deklarasi let handler', async () => {
        const files = getPluginFiles(realPluginDir)

        for (const file of files) {
            const source = fs.readFileSync(file, 'utf8')
            assert.match(
                source,
                /let\s+handler/,
                `${path.basename(file)} harus memakai "let handler"`
            )
            assert.match(source, /export default handler/, `${path.basename(file)} harus export default handler`)
        }
    })

    test('metadata plugin asli konsisten dengan registry', () => {
        const files = getPluginFiles(realPluginDir)

        for (const file of files) {
            const meta = metadata.get(file)
            assert.ok(meta, `${file} harus punya metadata`)

            for (const cmd of meta.commands) {
                assert.ok(plugins.get(cmd), `command ${cmd} dari ${file} harus terdaftar`)
            }
        }
    })
})
