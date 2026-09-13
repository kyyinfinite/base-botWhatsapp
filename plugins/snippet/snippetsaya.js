import { listMine } from '../../src/services/snippet/kyysnippet.js'

let handler = async (m, { notifReply }) => {
    try {
        const { snippets, limit } = await listMine()
        if (!snippets.length) return notifReply('Belum ada snippet yang dikirim lewat bot ini.', 'Snippet Saya')

        const list = snippets
            .map((s, i) => `${i + 1}. *${s.title}* [${s.status}]\n   id: ${s._id}`)
            .join('\n\n')

        await notifReply(`${list}\n\n${snippets.length}/${limit} slot terpakai.`, 'Snippet Saya')
    } catch (e) {
        await notifReply(`❌ ${e.message}`, 'Snippet Saya')
    }
}

handler.command = ['snippetsaya', 'mysnippet']
handler.owner = true

export default handler
