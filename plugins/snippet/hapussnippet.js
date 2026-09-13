import { remove } from '../../src/services/snippet/kyysnippet.js'

let handler = async (m, { args, notifReply }) => {
    if (!args[0]) return notifReply('Contoh:\n.hapussnippet <id>', 'Hapus Snippet')

    try {
        const result = await remove(args[0])
        await notifReply(result.message, 'Hapus Snippet')
    } catch (e) {
        await notifReply(`❌ ${e.message}`, 'Hapus Snippet')
    }
}

handler.command = ['hapussnippet', 'delsnippet']
handler.owner = true

export default handler
