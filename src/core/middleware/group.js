export async function groupMiddleware(ctx, handler) {
    if (!handler.group) return null
    if (ctx.isGroup) return null

    return {
        allowed: false,
        title: 'Group Only',
        message: ctx.accessDenied?.group || 'Perintah ini hanya dapat digunakan di dalam group.'
    }
}
