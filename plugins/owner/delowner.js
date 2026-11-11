import { owners } from '../../src/services/access.js'

let handler = async (m, { args, notifReply }) => {
    if (!args[0]) return notifReply('Contoh:\n.delowner 628xxx', 'Delete Owner')

    const number = args[0].replace(/[^0-9]/g, '')

    try {
        const removed = owners.remove(number)
        if (!removed) return notifReply(`${number} bukan Owner.`, 'Delete Owner')
        await notifReply(`✅ ${number} sudah bukan Owner.`, 'Delete Owner')
    } catch (e) {
        await notifReply(`❌ ${e.message}`, 'Delete Owner')
    }
}

handler.command = ['delowner', 'delown']
handler.creator = true

export default handler
