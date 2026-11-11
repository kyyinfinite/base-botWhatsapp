export async function privateMiddleware(ctx, handler) {
    if (!handler.private) return null
    if (!ctx.isGroup) return null

    return {
        allowed: false,
        title: 'Private Only',
        message: ctx.accessDenied?.private || 'Perintah ini hanya dapat digunakan di chat pribadi.'
    }
}
