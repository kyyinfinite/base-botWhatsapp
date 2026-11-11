import { normalizeMessage } from '../message/normalize.js'
import { plugins, getPatternPlugins } from '../plugin/registry.js'
import { createContext } from '../context/createContext.js'
import { runMiddleware } from '../middleware/engine.js'
import { parseCommand, parseButtonResponse, matchPatternPlugin } from './parse.js'
import { getConfiguredNumbers, toNumber, toUserJid } from '../../utils/identity.js'
import { captureFromMessage, captureFromGroupMetadata, resolveSenderIdentity } from '../../services/identity-resolver.js'
import { owners, premiums } from '../../services/access.js'
import { getConfig } from '../../services/config.js'
import { getCachedGroupMetadata } from '../../services/group-cache.js'
import { upsertUser } from '../../services/database/users.js'
import { getGroup, upsertGroup } from '../../services/database/groups.js'
import { messageQueue } from '../queue/engine.js'
import { isDuplicateMessage } from '../queue/dedupe.js'
import { reportPluginError } from '../errors/engine.js'

async function executePlugin(handler, m, context) {
    try {
        if (typeof handler !== 'function') {
            throw new TypeError('Plugin handler must be a function')
        }

        const result = await handler(m, {
            conn: context.conn,
            args: context.args,
            text: context.text,
            command: context.command,
            prefix: context.prefix,
            notifReply: context.notifReply,
            accessDenied: context.accessDenied,
            context
        })

        return { ok: true, result }
    } catch (error) {
        reportPluginError('plugin:execute', error, {
            plugin: handler?.__pluginFile || handler?.name || 'unknown',
            command: context?.command,
            chat: m?.chat,
            messageId: m?.id
        })
        return { ok: false }
    }
}

async function processMessage(conn, m, config) {
    const notifReply = async (text, title = 'Notification') => {
        await conn.sendMessage(m.chat, {
            text: `*${title}*\n\n${text}`
        }, { quoted: m })
    }

    const prefixes = Array.isArray(config.prefix) && config.prefix.length ? config.prefix : ['.']
    const accessDenied = config.accessDenied || {}

    let parsed = null
    let handler = null

    if (m.isButtonResponse) {
        parsed = parseButtonResponse(m, prefixes)
        handler = parsed?.command ? plugins.get(parsed.command) : null
    } else {
        const hasConfigPrefix = prefixes.some(p => m.text.startsWith(p))

        if (!hasConfigPrefix) {
            const patternHandler = matchPatternPlugin(m, getPatternPlugins())

            if (patternHandler) {
                handler = patternHandler
                parsed = { prefix: '', command: '', args: [], text: m.text }
            }
        }

        if (!handler) {
            parsed = parseCommand(m, prefixes)
            handler = parsed?.command ? plugins.get(parsed.command) : null
        }
    }

    if (!handler) return

    const context = createContext({
        conn,
        m,
        args: parsed.args,
        text: parsed.text,
        command: parsed.command,
        prefix: parsed.prefix,
        notifReply,
        accessDenied
    })

    const middleware = await runMiddleware(context, handler)
    if (!middleware.allowed) return

    const outcome = await executePlugin(handler, m, context)
    if (!outcome.ok) {
        context._limitRefund?.()
        context._cooldownRelease?.()
    }
}

export default async function handleMessage(conn, m) {
    try {
        normalizeMessage(m)

        const config = getConfig()

        await captureFromMessage(m?.key).catch(() => {})

        const identity = await resolveSenderIdentity(m)

        const identityNumbers = new Set(identity.jids.map(toNumber).filter(Boolean))

        const botJid = toUserJid(conn.user?.id || '')
        const botNumber = toNumber(botJid)

        const creatorNumbers = new Set([
            ...(config.creator || []),
            botNumber
        ].flatMap(value => getConfiguredNumbers(value)))

        const ownerNumbers = new Set(owners.numbers())
        const premiumNumbers = new Set(premiums.numbers())

        m.identityJids = identity.jids
        m.identityNumber = identity.number
        m.senderPn = identity.pn
        m.senderLid = identity.lid
        m.identityKey = identity.number || identity.lid || String(m.sender || 'unknown')
        m.chatKey = m.isGroup ? m.chat : (identity.pn || m.chat || 'unknown')

        m.isCreator = [...identityNumbers].some(number => creatorNumbers.has(number))
        m.isOwner = m.isCreator || [...identityNumbers].some(number => ownerNumbers.has(number))
        m.isPremium = m.isOwner || [...identityNumbers].some(number => premiumNumbers.has(number))

        m.userJid = identity.pn || toUserJid(m.sender) || m.sender || null

        m.userRecord = upsertUser({
            jid: m.userJid,
            name: m.pushName || '',
            isPremium: m.isPremium,
            isOwner: m.isOwner,
            isCreator: m.isCreator
        })

        if (m.isGroup && m.chat) {
            let groupName = m.groupName || ''
            const existingGroup = getGroup(m.chat)

            if (!existingGroup?.name) {
                try {
                    const metadata = await getCachedGroupMetadata(m.chat, conn)
                    groupName = metadata?.subject || groupName
                    await captureFromGroupMetadata(metadata).catch(() => {})
                } catch (e) {
                    reportPluginError('group:metadata', e, { chat: m.chat, messageId: m.id })
                }
            }

            m.groupRecord = upsertGroup({ jid: m.chat, name: groupName })
        }

        if (config.botMode === 'self' && !m.isOwner && !m.fromMe) return
        if (!m.text) return
        if (isDuplicateMessage(m.id)) return

        await messageQueue.add(m.chat || 'global', () => processMessage(conn, m, config))
    } catch (e) {
        reportPluginError('message', e, {
            chat: m?.chat,
            messageId: m?.id,
            command: m?.text
        })
    }
}
