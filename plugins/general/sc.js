import path from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'
import { Button } from '../../src/lib/message/wrapper.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const thumbPath = path.join(__dirname, '../../src/assets/media/thumb.jpg')

let handler = async (m, { conn }) => {
    const pushname = m.pushName || 'No Name'

    const sc = `\`</> SOURCE CODE\``

    const anu = `
    hello, \`${pushname}\`
source code ini tersedia untuk kamu yang ingin
mempelajari, mengembangkan, atau memodifikasi
base script ini.

"ACCESS"

«status   : PUBLIC
license  : FREE
creator  : kyyinfinite»

"RULES"

1. CREDITS
   Jangan hapus credit original.
   Credit wajib tetap dicantumkan.

2. RESALE
   Dilarang menjual base script ini
   dalam bentuk original.

3. MODIFICATION
   Boleh diperjualbelikan jika sudah
   ditambahkan fitur atau modifikasi sendiri.

4. OWNERSHIP
   Dilarang mengklaim source code ini
   sebagai karya 100% milik sendiri.

"SYSTEM MESSAGE"

source ini dibuat untuk dikembangkan,
bukan untuk diakui sebagai milik sendiri.

</> happy coding, ${pushname}
`.trim()

    try {
        const thumb = await sharp(thumbPath).resize(300, 300).jpeg({ quality: 80 }).toBuffer()

        await new Button(conn)
            .setImage(thumb)
            .setBody(sc)
            .setFooter(anu)
            .addUrl('get sc', 'https://github.com/kyyinfinite/base-botWhatsapp')
            .send(m.chat, { quoted: m })
    } catch (e) {
        console.error(e)
        await conn.sendMessage(m.chat, { text: `❌ Gagal kirim pesan: ${e.message}` }, { quoted: m })
    }
}

handler.command = ['sc', 'script', 'getsc']

export default handler
