import { events } from '../events/engine.js'

export const plugins = new Map()

const owners = new Map()

export const metadata = new Map()

const patternKeys = new Set()

const ALLOWED_META_TYPES = {
    help: 'arrayLike',
    tags: 'arrayLike',
    description: 'string',
    owner: 'boolean',
    creator: 'boolean',
    premium: 'boolean',
    group: 'boolean',
    private: 'boolean',
    admin: 'boolean',
    botAdmin: 'boolean',
    cooldown: 'number',
    limit: 'numberOrTrue',
    customPrefix: 'regexp',
    before: 'function',
    after: 'function'
}

function toCommandList(command) {
    const list = Array.isArray(command) ? command : [command]
    const cleaned = []
    for (const item of list) {
        if (typeof item !== 'string' || !item.trim()) {
            throw new TypeError(`handler.command harus string atau array of string, dapat: ${typeof item}`)
        }
        cleaned.push(item.trim().toLowerCase())
    }
    return [...new Set(cleaned)]
}

export function validatePlugin(handler) {
    if (!handler || typeof handler !== 'function') {
        throw new TypeError('Plugin harus berupa fungsi handler')
    }

    const hasCommand = handler.command !== undefined && handler.command !== null
    const hasPattern = !!handler.customPrefix

    if (!hasCommand && !hasPattern) {
        throw new TypeError('Plugin butuh handler.command atau handler.customPrefix')
    }

    if (hasCommand && !(handler.command instanceof RegExp)) {
        toCommandList(handler.command)
    }

    for (const [key, kind] of Object.entries(ALLOWED_META_TYPES)) {
        const value = handler[key]
        if (value === undefined || value === null) continue

        const valid =
            kind === 'arrayLike' ? (Array.isArray(value) || typeof value === 'string') :
            kind === 'string' ? typeof value === 'string' :
            kind === 'boolean' ? typeof value === 'boolean' :
            kind === 'number' ? typeof value === 'number' && Number.isFinite(value) && value >= 0 :
            kind === 'numberOrTrue' ? value === true || (typeof value === 'number' && Number.isFinite(value) && value >= 0) :
            kind === 'regexp' ? value instanceof RegExp :
            kind === 'function' ? typeof value === 'function' : false

        if (!valid) {
            throw new TypeError(`handler.${key} tidak valid (dapat: ${typeof value})`)
        }
    }

    return true
}

function buildMetadata(handler, commands) {
    return {
        commands,
        help: handler.help || [],
        tags: handler.tags || [],
        description: handler.description || '',
        owner: !!handler.owner,
        creator: !!handler.creator,
        premium: !!handler.premium,
        group: !!handler.group,
        private: !!handler.private,
        admin: !!handler.admin,
        botAdmin: !!handler.botAdmin,
        cooldown: handler.cooldown || 0,
        limit: handler.limit || 0
    }
}

function applyRegistration(file, handler) {
    const keys = []
    const commands = []

    if (handler.command instanceof RegExp) {
        const key = Symbol(file)
        plugins.set(key, handler)
        patternKeys.add(key)
        keys.push(key)
    } else if (handler.command) {
        for (const cmd of toCommandList(handler.command)) {
            const existingOwner = owners.get(cmd)

            if (existingOwner && existingOwner !== file) {
                console.warn(`[PLUGIN COLLISION] "${cmd}" dari ${file} bertabrakan dengan ${existingOwner} — ${existingOwner} dipertahankan`)
                events.emit('plugin:collision', file, existingOwner, cmd)
                continue
            }

            plugins.set(cmd, handler)
            owners.set(cmd, file)
            keys.push(cmd)
            commands.push(cmd)
        }
    }

    if (handler.customPrefix) {
        const key = Symbol(file)
        plugins.set(key, handler)
        patternKeys.add(key)
        keys.push(key)
    }

    return { keys, commands }
}

function removeKeys(file, keys) {
    for (const key of keys) {
        if (typeof key === 'string') {
            if (owners.get(key) !== file) continue
            plugins.delete(key)
            owners.delete(key)
        } else {
            if (key.description !== file) continue
            plugins.delete(key)
            patternKeys.delete(key)
        }
    }
}

export function registerPlugin(file, handler) {
    validatePlugin(handler)

    const { keys, commands } = applyRegistration(file, handler)

    metadata.set(file, buildMetadata(handler, commands))
    events.emit('plugin:loaded', file, keys)

    return keys
}

export function unregisterPlugin(file, keys = []) {
    removeKeys(file, keys)
    metadata.delete(file)
    events.emit('plugin:unloaded', file)
}

export function getKeysOf(file) {
    const keys = []
    for (const [key] of plugins.entries()) {
        if (typeof key === 'string' ? owners.get(key) === file : key.description === file) {
            keys.push(key)
        }
    }
    return keys
}

export function replacePlugin(file, oldKeys, nextHandler) {
    validatePlugin(nextHandler)

    const oldHandler = oldKeys.length ? plugins.get(oldKeys[0]) : null
    const hadRegistration = oldKeys.length > 0

    if (hadRegistration) {
        removeKeys(file, oldKeys)
        metadata.delete(file)
    }

    try {
        return registerPlugin(file, nextHandler)
    } catch (error) {
        if (oldHandler) {
            try {
                const { keys, commands } = applyRegistration(file, oldHandler)
                metadata.set(file, buildMetadata(oldHandler, commands))
                events.emit('plugin:loaded', file, keys)
            } catch {}
        }
        throw error
    }
}

export function getPatternPlugins() {
    return [...patternKeys].map(key => plugins.get(key)).filter(Boolean)
}
