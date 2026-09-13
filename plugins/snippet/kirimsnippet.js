import { submit, ALLOWED_LANGUAGES } from '../../src/services/snippet/kyysnippet.js'

let handler = async (m, { text, notifReply }) => {
    if (!m.quoted || !m.quoted.text) {
        return notifReply(
            `Reply pesan yang berisi kode dengan format:\n.kirimsnippet <judul>|<bahasa>|<deskripsi>\n\nBahasa yang didukung: ${ALLOWED_LANGUAGES.join(', ')}`,
            'Kirim Snippet'
        )
    }

    const [title, language, ...descParts] = text.split('|').map(v => v.trim())
    const description = descParts.join('|').trim()

    if (!title || !language || !description) {
        return notifReply('Format salah. Contoh:\n.kirimsnippet Hitung Faktorial|javascript|Fungsi rekursif faktorial', 'Kirim Snippet')
    }

    try {
        const result = await submit({
            title,
            description,
            language: language.toLowerCase(),
            code: m.quoted.text
        })
        await notifReply(`${result.message}\n\nid: ${result.snippet._id}`, 'Kirim Snippet')
    } catch (e) {
        await notifReply(`❌ ${e.message}`, 'Kirim Snippet')
    }
}

handler.command = ['kirimsnippet', 'submitsnippet']
handler.owner = true

export default handler
