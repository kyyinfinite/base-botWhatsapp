import { getAdminState } from './admin.js'

export async function botAdminMiddleware(ctx, handler) {
    if (!handler.botAdmin) return null

    try {
        const { isBotAdmin } = await getAdminState(ctx)
        if (isBotAdmin) return null
    } catch (error) {
        console.error('[MIDDLEWARE] Failed to resolve bot admin state:', error)
    }

    return {
        allowed: false,
        title: 'Bot Admin Required',
        message: ctx.accessDenied?.botAdmin || 'Bot harus menjadi admin group untuk menjalankan perintah ini.'
    }
}
