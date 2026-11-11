import { settings } from '../../services/database/json.js'
import { resetAllUserLimits } from '../../services/database/users.js'
import { getDailyLimit } from '../../services/config.js'

const CHECK_INTERVAL_MS = 15 * 60 * 1000
const SETTINGS_KEY = 'limitReset'
const todayKey = () => new Date().toISOString().slice(0, 10)

function checkAndReset() {
    const today = todayKey()
    const state = settings.get(SETTINGS_KEY) || {}
    if (state.lastResetDate === today) return

    const count = resetAllUserLimits(getDailyLimit())
    settings.set(SETTINGS_KEY, { lastResetDate: today })
    console.log(`[SCHEDULER] Daily limit reset applied to ${count} user(s).`)
}

export function startLimitResetScheduler() {
    checkAndReset()
    const interval = setInterval(checkAndReset, CHECK_INTERVAL_MS)
    interval.unref?.()
    return interval
}
