export async function ownerMiddleware(ctx, handler) {
    if (!handler.owner) return null
    if (ctx.isOwner) return null

    return {
        allowed: false,
        title: 'Access Denied',
        message: ctx.accessDenied?.owner || 'Perintah ini hanya dapat digunakan oleh owner.'
    }
}
