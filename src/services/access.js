import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { toUserJid, toNumber, getConfiguredNumbers } from '../utils/identity.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, '../database')
const ownerPath = process.env.WA_OWNER_PATH || path.join(dataDir, 'owner.json')
const premiumPath = process.env.WA_PREMIUM_PATH || path.join(dataDir, 'premium.json')

function readList(file) {
    try {
        const stat = fs.statSync(file)
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
        return { list: Array.isArray(raw) ? raw : [], mtimeMs: stat.mtimeMs }
    } catch {
        return { list: [], mtimeMs: 0 }
    }
}

function writeList(file, list) {
    const temp = `${file}.tmp`
    fs.writeFileSync(temp, JSON.stringify(list, null, 2))
    fs.renameSync(temp, file)
}

function createListStore(file) {
    let cache = null
    let cachedMtimeMs = -1

    const load = () => {
        let mtimeMs = 0
        try {
            mtimeMs = fs.statSync(file).mtimeMs
        } catch {}

        if (cache && mtimeMs === cachedMtimeMs) return cache

        const { list, mtimeMs: m } = readList(file)
        cache = list
        cachedMtimeMs = m
        return cache
    }

    return {
        all: () => load(),
        numbers: () => getConfiguredNumbers(load()),
        has: (value) => {
            const number = toNumber(value)
            if (!number) return false
            return load().some(entry => getConfiguredNumbers(entry).includes(number))
        },
        add: (value) => {
            const jid = toUserJid(value)
            if (!jid) throw new TypeError('Nomor tidak valid')

            const list = load()
            const number = toNumber(jid)
            if (list.some(entry => getConfiguredNumbers(entry).includes(number))) return false

            list.push(jid)
            writeList(file, list)
            cache = list
            cachedMtimeMs = fs.statSync(file).mtimeMs
            return true
        },
        remove: (value) => {
            const number = toNumber(value)
            if (!number) return false

            const list = load()
            const index = list.findIndex(entry => getConfiguredNumbers(entry).includes(number))
            if (index === -1) return false

            list.splice(index, 1)
            writeList(file, list)
            cache = list
            cachedMtimeMs = fs.statSync(file).mtimeMs
            return true
        }
    }
}

export const owners = createListStore(ownerPath)
export const premiums = createListStore(premiumPath)
