import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const configPath = process.env.WA_CONFIG_PATH || path.join(__dirname, '../../config.json')

let cache = null
let cachedMtimeMs = 0

function readFromDisk() {
    const stat = fs.statSync(configPath)
    if (cache && stat.mtimeMs === cachedMtimeMs) return cache

    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    cache = raw && typeof raw === 'object' ? raw : {}
    cachedMtimeMs = stat.mtimeMs
    return cache
}

export function getConfig() {
    return readFromDisk()
}

export function updateConfig(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new TypeError('Config patch must be a plain object')
    }

    const current = readFromDisk()
    const next = { ...current, ...patch }

    const temp = `${configPath}.tmp`
    fs.writeFileSync(temp, JSON.stringify(next, null, 2))
    fs.renameSync(temp, configPath)

    cache = next
    cachedMtimeMs = fs.statSync(configPath).mtimeMs

    return next
}

export function getDailyLimit() {
    const limit = Number(getConfig().dailyLimit)
    return Number.isFinite(limit) && limit > 0 ? limit : 10
}

export default { getConfig, updateConfig, getDailyLimit }
