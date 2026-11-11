export async function premiumMiddleware(ctx, handler) {
    if (!handler.premium) return null
    if (ctx.isPremium) return null

    return {
        allowed: false,
        title: 'Access Denied',
        message: ctx.accessDenied?.premium || 'Perintah ini hanya dapat digunakan oleh pengguna premium.'
    }
}
