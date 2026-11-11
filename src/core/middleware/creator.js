export async function creatorMiddleware(ctx, handler) {
    if (!handler.creator) return null
    if (ctx.isCreator) return null

    return {
        allowed: false,
        title: 'Access Denied',
        message: ctx.accessDenied?.creator || 'Perintah ini hanya dapat digunakan oleh creator.'
    }
}
