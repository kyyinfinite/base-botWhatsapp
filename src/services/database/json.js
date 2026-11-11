import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const databaseDir = process.env.WA_DATABASE_DIR || path.join(__dirname, '../../database')
const cache = new Map()
const dirty = new Set()
const writeFailures = new Map()

let flushTimer = null

const FLUSH_DELAY_MS = 250
const RETRY_DELAY_MAX_MS = 30000
const RETRY_LIMIT = 5

const ensureFile = (name, fallback = {}) => {
    const file = path.join(databaseDir, name)
    if (!fs.existsSync(databaseDir)) fs.mkdirSync(databaseDir, { recursive: true })
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(fallback, null, 2))
    return file
}

const read = (name, fallback = {}) => {
    if (cache.has(name)) return cache.get(name)
    const file = ensureFile(name, fallback)
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'))
        const value = data && typeof data === 'object' ? data : fallback
        cache.set(name, value)
        return value
    } catch (error) {
        console.error(`[DATABASE] Gagal baca ${name}:`, error.message)
        cache.set(name, fallback)
        return fallback
    }
}

const writeSync = (name, data) => {
    const file = ensureFile(name)
    const temp = `${file}.tmp`
    fs.writeFileSync(temp, JSON.stringify(data, null, 2))
    fs.renameSync(temp, file)
    cache.set(name, data)
    dirty.delete(name)
    writeFailures.delete(name)
    return data
}

const write = (name, data) => {
    cache.set(name, data)
    dirty.add(name)
    scheduleFlush()
    return data
}

function scheduleFlush(delayMs = FLUSH_DELAY_MS) {
    if (flushTimer) return
    flushTimer = setTimeout(() => {
        flushTimer = null
        flushDirty().catch(error => console.error('[DATABASE] Gagal flush:', error.message))
    }, delayMs)
    flushTimer.unref?.()
}

function flushNow() {
    for (const name of [...dirty]) {
        const data = cache.get(name)
        if (data === undefined) {
            dirty.delete(name)
            continue
        }
        try {
            writeSync(name, data)
        } catch (error) {
            const failures = (writeFailures.get(name) || 0) + 1
            writeFailures.set(name, failures)
            console.error(`[DATABASE] Gagal tulis ${name} (percobaan ${failures}):`, error.message)
            if (failures <= RETRY_LIMIT) {
                scheduleFlush(Math.min(RETRY_DELAY_MAX_MS, FLUSH_DELAY_MS * 2 ** failures))
            }
        }
    }
}

export async function flushDirty() {
    flushNow()
}

const collection = name => ({
    all: () => read(name, {}),
    get: id => read(name, {})[id] || null,
    set: (id, value) => {
        const data = read(name, {})
        data[id] = value
        return write(name, data)
    },
    touch: (id, patch) => {
        const data = read(name, {})
        data[id] = { ...(data[id] || {}), ...patch }
        write(name, data)
        return data[id]
    },
    setAll: data => write(name, data),
    delete: id => {
        const data = read(name, {})
        delete data[id]
        return write(name, data)
    }
})

export const flushAll = () => {
    if (flushTimer) {
        clearTimeout(flushTimer)
        flushTimer = null
    }
    flushNow()
}

export const users = collection('users.json')
export const groups = collection('groups.json')
export const settings = collection('settings.json')
export const identityMappings = collection('identity.json')
export const jsonDatabase = { users, groups, settings, identityMappings }
export default jsonDatabase
