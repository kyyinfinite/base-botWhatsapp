import { tryConsumeUserLimit, refundUserLimit } from '../../services/database/users.js'

export async function limitMiddleware(ctx, handler) {
    const cost = handler.limit === true ? 1 : Number(handler.limit || 0)
    if (!Number.isFinite(cost) || cost <= 0) return null
    if (ctx.isOwner) return null

    const target = ctx.m?.userJid || ctx.sender
    const denied = {
        allowed: false,
        title: 'Limit Reached',
        message: ctx.accessDenied?.limit || 'Batas penggunaan perintah ini sudah habis.'
    }

    if (!target) return denied

    const reserved = tryConsumeUserLimit(target, cost)
    if (reserved !== null && reserved !== false) {
        ctx._limitRefund = () => refundUserLimit(target, cost)
        return null
    }

    return denied
}
