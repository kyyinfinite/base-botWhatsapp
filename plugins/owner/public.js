import { updateConfig, getConfig } from '../../src/services/config.js'

let handler = async (m, { conn, notifReply }) => {
    if (getConfig().botMode === 'public') return notifReply('Bot sudah dalam mode Public.', 'Mode Public')

    updateConfig({ botMode: 'public' })
    conn.public = true
    await notifReply('Bot mode berhasil diubah ke Public.', 'Mode Public')
}

handler.command = ['public']
handler.owner = true

export default handler
