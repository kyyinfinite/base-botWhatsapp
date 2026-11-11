export function parseCommand(m, prefixes) {
    const text = m.text || ''
    if (!text.trim()) return null

    const prefix = prefixes.find(p => text.startsWith(p))

    if (prefix !== undefined) {
        const body = text.slice(prefix.length).trim()
        if (!body) return null

        const parts = body.split(/\s+/)
        const command = parts.shift().toLowerCase()
        return { prefix, command, args: parts, text: parts.join(' ') }
    }

    const trimmed = text.trim()
    if (/\s/.test(trimmed)) return null

    return { prefix: '', command: trimmed.toLowerCase(), args: [], text: '' }
}

export function parseButtonResponse(m, prefixes) {
    let body = m.text || ''
    if (!body.trim()) return null

    let prefix = ''
    for (const p of prefixes) {
        if (body.startsWith(p)) {
            prefix = p
            body = body.slice(p.length)
            break
        }
    }

    const parts = body.trim().split(/\s+/).filter(Boolean)
    if (!parts.length) return null

    const command = parts.shift().toLowerCase()
    return { prefix, command, args: parts, text: parts.join(' ') }
}

export function matchPatternPlugin(m, patternPlugins) {
    const text = m.text || ''
    if (!text) return null

    let looseMatch = null

    for (const handler of patternPlugins) {
        const { customPrefix } = handler
        if (!customPrefix) continue

        const anchored = customPrefix.source.startsWith('^')
        if (!customPrefix.test(text)) continue

        if (anchored) return handler
        if (!looseMatch) looseMatch = handler
    }

    return looseMatch
}
