import { browse } from '../../src/services/snippet/kyysnippet.js'

let handler = async (m, { args, notifReply }) => {
    if (!args[0]) return notifReply('Contoh:\n.carisnippet whatsapp bot\n.carisnippet lang:python', 'Cari Snippet')

    let language
    let search = args.join(' ')
    const langMatch = search.match(/lang:(\S+)/i)
    if (langMatch) {
        language = langMatch[1].toLowerCase()
        search = search.replace(langMatch[0], '').trim()
    }

    try {
        const snippets = await browse({ search: search || undefined, language })
        if (!snippets.length) return notifReply('Tidak ada snippet yang cocok.', 'Cari Snippet')

        const list = snippets
            .slice(0, 10)
            .map((s, i) => `${i + 1}. *${s.title}* [${s.language}]\n   id: ${s._id}`)
            .join('\n\n')

        await notifReply(`${list}\n\nKetik *.getsnippet <id>* untuk lihat kodenya.`, `Hasil Pencarian (${snippets.length})`)
    } catch (e) {
        await notifReply(`❌ ${e.message}`, 'Cari Snippet')
    }
}

handler.command = ['carisnippet', 'searchsnippet']

export default handler
