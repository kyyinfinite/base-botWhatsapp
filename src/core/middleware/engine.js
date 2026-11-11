import { ownerMiddleware } from './owner.js'
import { creatorMiddleware } from './creator.js'
import { premiumMiddleware } from './premium.js'
import { groupMiddleware } from './group.js'
import { privateMiddleware } from './private.js'
import { adminMiddleware } from './admin.js'
import { botAdminMiddleware } from './botAdmin.js'
import { cooldownMiddleware } from './cooldown.js'
import { limitMiddleware } from './limit.js'
import { reportPluginError } from '../errors/engine.js'

const middlewares = [
    ownerMiddleware,
    creatorMiddleware,
    premiumMiddleware,
    groupMiddleware,
    privateMiddleware,
    adminMiddleware,
    botAdminMiddleware,
    cooldownMiddleware,
    limitMiddleware
]

export function useMiddleware(fn) {
    if (typeof fn !== 'function') {
        throw new TypeError('Middleware harus berupa fungsi')
    }
    middlewares.push(fn)
    return () => {
        const index = middlewares.indexOf(fn)
        if (index !== -1) middlewares.splice(index, 1)
    }
}

export async function runMiddleware(ctx, handler) {
    for (const middleware of middlewares) {
        let result
        try {
            result = await middleware(ctx, handler)
        } catch (error) {
            reportPluginError('middleware', error, {
                command: ctx?.command,
                chat: ctx?.chat,
                middleware: middleware.name || 'anonymous'
            })

            const message = 'Terjadi kesalahan pada pemeriksaan akses. Coba lagi nanti.'
            try {
                await ctx.notifReply(message, 'Error')
            } catch {}

            return { allowed: false, title: 'Error', message }
        }

        if (!result) continue

        if (result === true) return { allowed: true }

        if (result.allowed === false) {
            if (result.message) await ctx.notifReply(result.message, result.title || 'Access Denied')
            return result
        }
    }

    return { allowed: true }
}

export function getMiddlewares() {
    return [...middlewares]
}
