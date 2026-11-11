import path from 'path'
import { metadata } from '../core/plugin/registry.js'

const CATEGORY_MAP = {
    general: { id: 'general', title: 'General', description: 'Command umum dan navigasi' },
    game: { id: 'game', title: 'Game', description: 'Permainan dan hiburan' },
    snippet: { id: 'snippet', title: 'Snippet', description: 'Simpan dan berbagi kode' },
    owner: { id: 'owner', title: 'Owner', description: 'Pengelolaan bot dan akses owner' },
    shell: { id: 'system', title: 'System', description: 'Tools sistem dan internal' }
}

function folderOf(file) {
    const parts = String(file).split(path.sep)
    return parts.at(-2)?.toLowerCase() || 'general'
}

function permission(meta) {
    const access = []
    if (meta.owner) access.push('owner')
    if (meta.creator) access.push('creator')
    if (meta.premium) access.push('premium')
    if (meta.group) access.push('group')
    if (meta.private) access.push('private')
    if (meta.admin) access.push('admin')
    if (meta.botAdmin) access.push('bot admin')
    return access
}

function allowed(meta, ctx) {
    if (meta.owner && !ctx.isOwner) return false
    if (meta.creator && !ctx.isCreator) return false
    if (meta.premium && !ctx.isPremium && !ctx.isOwner && !ctx.isCreator) return false
    if (meta.group && !ctx.isGroup) return false
    if (meta.private && ctx.isGroup) return false
    if (meta.admin && !ctx.isAdmin && !ctx.isOwner && !ctx.isCreator) return false
    if (meta.botAdmin && !ctx.isBotAdmin && !ctx.isOwner && !ctx.isCreator) return false
    return true
}

export function getMenuData(ctx = {}) {
    const groups = new Map()

    for (const [file, meta] of metadata.entries()) {
        if (!allowed(meta, ctx)) continue

        const folder = folderOf(file)
        const info = CATEGORY_MAP[folder] || CATEGORY_MAP.general
        if (!groups.has(info.id)) groups.set(info.id, { ...info, commands: [] })

        const commands = Array.isArray(meta.commands) ? meta.commands.filter(Boolean) : []
        if (!commands.length) continue

        const description = String(meta.description || '').replace(/[<>]/g, '') || 'Fitur bot'
        const access = permission(meta)

        for (const command of commands) {
            const name = String(command).toLowerCase()
            if (!groups.get(info.id).commands.some(item => item.command === name)) {
                groups.get(info.id).commands.push({
                    command: name,
                    description,
                    access,
                    plugin: path.basename(file, '.js')
                })
            }
        }
    }

    const categories = [...groups.values()]
        .map(category => ({
            ...category,
            commands: category.commands.sort((a, b) => a.command.localeCompare(b.command))
        }))
        .sort((a, b) => a.title.localeCompare(b.title))

    return {
        version: 1,
        generatedAt: new Date().toISOString(),
        categories
    }
}

export function getMenuCommands(ctx = {}) {
    const data = getMenuData(ctx)
    return data.categories.flatMap(category =>
        category.commands.map(command => ({
            ...command,
            category: category.id,
            categoryTitle: category.title
        }))
    )
}
