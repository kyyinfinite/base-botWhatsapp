import { premiums } from '../../src/services/access.js'

let handler = async (m, { args, notifReply }) => {
    if (!args[0]) return notifReply('Contoh:\n.delprem 628xxx', 'Delete Premium')

    const number = args[0].replace(/[^0-9]/g, '')

    try {
        const removed = premiums.remove(number)
        if (!removed) return notifReply(`${number} bukan Premium.`, 'Delete Premium')
        await notifReply(`✅ ${number} sudah bukan Premium.`, 'Delete Premium')
    } catch (e) {
        await notifReply(`❌ ${e.message}`, 'Delete Premium')
    }
}

handler.command = ['delprem', 'delpremium']
handler.creator = true

export default handler
