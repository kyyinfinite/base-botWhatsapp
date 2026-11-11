import { premiums } from '../../src/services/access.js'

let handler = async (m, { conn, args, notifReply }) => {
    if (!args[0]) return notifReply('Contoh:\n.addprem 628xxx', 'Add Premium')

    const number = args[0].replace(/[^0-9]/g, '')
    const target = number + '@s.whatsapp.net'

    const cek = await conn.onWhatsApp(target).catch(() => [])
    if (!cek.length) return notifReply('Nomor tidak valid / tidak terdaftar di WhatsApp.', 'Add Premium')

    try {
        const added = premiums.add(target)
        if (!added) return notifReply(`${target} sudah menjadi Premium.`, 'Add Premium')
        await notifReply(`✅ ${target} telah menjadi Premium.`, 'Add Premium')
    } catch (e) {
        await notifReply(`❌ ${e.message}`, 'Add Premium')
    }
}

handler.command = ['addprem', 'addpremium']
handler.creator = true

export default handler
