import { owners } from '../../src/services/access.js'

let handler = async (m, { conn, args, notifReply }) => {
    if (!args[0]) return notifReply('Contoh:\n.addowner 628xxx', 'Add Owner')

    const number = args[0].replace(/[^0-9]/g, '')
    const target = number + '@s.whatsapp.net'

    const cek = await conn.onWhatsApp(target).catch(() => [])
    if (!cek.length) return notifReply('Nomor tidak valid / tidak terdaftar di WhatsApp.', 'Add Owner')

    try {
        const added = owners.add(target)
        if (!added) return notifReply(`${target} sudah menjadi Owner.`, 'Add Owner')
        await notifReply(`✅ ${target} telah menjadi Owner.`, 'Add Owner')
    } catch (e) {
        await notifReply(`❌ ${e.message}`, 'Add Owner')
    }
}

handler.command = ['addowner', 'addown']
handler.creator = true

export default handler
