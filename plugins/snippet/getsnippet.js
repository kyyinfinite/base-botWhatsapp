import { getById, getRaw } from '../../src/services/snippet/kyysnippet.js'

const EXTENSION = {
    javascript: 'js',
    typescript: 'ts',
    python: 'py',
    bash: 'sh',
    json: 'json'
}

let handler = async (m, { args, conn, notifReply }) => {
    if (!args[0]) return notifReply('Contoh:\n.getsnippet <id>', 'Get Snippet')

    const id = args[0]

    try {
        const snippet = await getById(id)
        const code = await getRaw(id)

        const caption = `*${snippet.title}*\n${snippet.description}\n\nlanguage: ${snippet.language}\nby: ${snippet.ownerLabel || 'anonymous'}`

        if (code.length <= 3500) {
            await conn.sendMessage(m.chat, {
                text: `${caption}\n\n\`\`\`${code}\`\`\``
            }, { quoted: m })
            return
        }

        const ext = EXTENSION[snippet.language] || 'txt'
        await conn.sendMessage(m.chat, {
            document: Buffer.from(code, 'utf8'),
            fileName: `${snippet.title.replace(/[^a-zA-Z0-9._-]/g, '_')}.${ext}`,
            mimetype: 'text/plain',
            caption
        }, { quoted: m })
    } catch (e) {
        await notifReply(`❌ ${e.message}`, 'Get Snippet')
    }
}

handler.command = ['getsnippet', 'ambilsnippet']

export default handler
