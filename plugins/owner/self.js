import { updateConfig, getConfig } from '../../src/services/config.js'

let handler = async (m, { conn, notifReply }) => {
    if (getConfig().botMode === 'self') return notifReply('Bot sudah dalam mode Self.', 'Mode Self')

    updateConfig({ botMode: 'self' })
    conn.public = false
    await notifReply('Bot mode berhasil diubah ke Self.', 'Mode Self')
}

handler.command = ['self']
handler.owner = true

export default handler
