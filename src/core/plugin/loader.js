import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { plugins, registerPlugin, unregisterPlugin, replacePlugin, getKeysOf, validatePlugin } from './registry.js'
import { events } from '../events/engine.js'
import { reportPluginError } from '../errors/engine.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const defaultPluginDir = path.join(__dirname, '../../../plugins')

const pluginCache = new Map()
const watchers = new Map()
const pendingReloads = new Map()

let cacheCounter = 0

export function getPluginFiles(dir) {
    let files = []
    if (!fs.existsSync(dir)) return files
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, item.name)
        if (item.isDirectory()) files.push(...getPluginFiles(full))
        else if (item.isFile() && item.name.endsWith('.js') && !item.name.startsWith('.')) files.push(full)
    }
    return files
}

export async function loadPlugin(file) {
    try {
        const cacheBust = `${Date.now()}-${cacheCounter++}`
        const module = await import(`${pathToFileURL(file).href}?update=${cacheBust}`)
        const handler = module.default

        if (!handler) return null

        validatePlugin(handler)

        if (pluginCache.has(file)) {
            pluginCache.set(file, replacePlugin(file, pluginCache.get(file), handler))
        } else {
            pluginCache.set(file, registerPlugin(file, handler))
        }

        events.emit('plugin:file-loaded', file)
        return handler
    } catch (e) {
        reportPluginError('plugin:load', e, { file })
        events.emit('plugin:error', file, e)
        return null
    }
}

export async function unloadPlugin(file) {
    if (!pluginCache.has(file)) return false
    unregisterPlugin(file, pluginCache.get(file))
    pluginCache.delete(file)
    return true
}

export async function initPlugins(pluginDir = defaultPluginDir) {
    for (const file of getPluginFiles(pluginDir)) {
        await loadPlugin(file)
    }
    watch(pluginDir)
    return pluginCache.size
}

function watch(dir) {
    if (watchers.has(dir)) return

    const watcher = fs.watch(dir, (_, filename) => {
        if (!filename || filename.startsWith('.')) return

        if (!filename.endsWith('.js')) {
            handleNewDir(dir, filename)
            return
        }

        const file = path.join(dir, filename)
        if (pendingReloads.has(file)) clearTimeout(pendingReloads.get(file))
        pendingReloads.set(file, setTimeout(() => {
            pendingReloads.delete(file)
            if (fs.existsSync(file)) loadPlugin(file)
            else unloadPlugin(file)
        }, 200))
    })

    watchers.set(dir, watcher)

    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        if (item.isDirectory()) watch(path.join(dir, item.name))
    }
}

function handleNewDir(parentDir, dirname) {
    const dir = path.join(parentDir, dirname)
    let stat
    try {
        stat = fs.statSync(dir)
    } catch {
        return
    }

    if (!stat.isDirectory()) return

    for (const file of getPluginFiles(dir)) {
        if (!pluginCache.has(file)) loadPlugin(file)
    }
    watch(dir)
}

export function stopWatching() {
    for (const watcher of watchers.values()) watcher.close()
    watchers.clear()
    for (const timer of pendingReloads.values()) clearTimeout(timer)
    pendingReloads.clear()
}

export function getLoadedPluginFiles() {
    return [...pluginCache.keys()]
}

export { plugins }

export default { initPlugins, loadPlugin, unloadPlugin, getPluginFiles }
