import { consumeUserLimit } from '../../services/database/users.js'

export async function limitMiddleware(ctx, handler) {
    const cost = handler.limit === true ? 1 : Number(handler.limit || 0)
    if (!Number.isFinite(cost) || cost <= 0) return null
    if (ctx.isOwner) return null

    const remaining = Number.isFinite(ctx.user?.limit) ? ctx.user.limit : 0
    if (remaining < cost) {
        return {
            allowed: false,
            title: 'Limit Reached',
            message: ctx.accessDenied?.limit || 'Batas penggunaan perintah ini sudah habis.'
        }
    }

    ctx._limitCommit = () => {
        consumeUserLimit(ctx.m?.userJid || ctx.sender, cost)
    }

    return null
}
