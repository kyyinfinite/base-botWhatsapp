const normalize = (conn, jid) => {
    if (!jid) return ''
    return String(conn.decodeJid?.(jid) || jid).toLowerCase()
}

async function getAdminState(ctx) {
    if (!ctx.isGroup) return { isAdmin: false, isBotAdmin: false }
    if (ctx.m?.isAdmin !== undefined && ctx.m?.isBotAdmin !== undefined) {
        return { isAdmin: !!ctx.m.isAdmin, isBotAdmin: !!ctx.m.isBotAdmin }
    }

    const metadata = await ctx.conn.groupMetadata(ctx.chat)
    const participants = metadata?.participants || []
    const sender = normalize(ctx.conn, ctx.sender)
    const bot = normalize(ctx.conn, ctx.conn.user?.id)

    const isAdminParticipant = jid => {
        const participant = participants.find(p => normalize(ctx.conn, p.id) === jid)
        return participant?.admin === 'admin' || participant?.admin === 'superadmin'
    }

    const state = {
        isAdmin: isAdminParticipant(sender),
        isBotAdmin: isAdminParticipant(bot)
    }

    ctx.m.isAdmin = state.isAdmin
    ctx.m.isBotAdmin = state.isBotAdmin
    ctx.isAdmin = state.isAdmin
    ctx.isBotAdmin = state.isBotAdmin
    if (ctx.group) {
        ctx.group.isAdmin = state.isAdmin
        ctx.group.isBotAdmin = state.isBotAdmin
    }

    return state
}

export async function adminMiddleware(ctx, handler) {
    if (!handler.admin) return null

    try {
        const { isAdmin } = await getAdminState(ctx)
        if (isAdmin) return null
    } catch (error) {
        console.error('[MIDDLEWARE] Failed to resolve group admin state:', error)
    }

    return {
        allowed: false,
        title: 'Admin Only',
        message: ctx.accessDenied?.admin || 'Perintah ini hanya dapat digunakan oleh admin group.'
    }
}

export { getAdminState }
