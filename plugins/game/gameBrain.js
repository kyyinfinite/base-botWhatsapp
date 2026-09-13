import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Foad2 } from '../../src/lib/message/wrapper.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const markupPath = path.join(__dirname, '../../src/assets/markup')

const games = [
    {
        id: 'asah_otak',
        title: 'Asah Otak',
        file: 'asahotak.html'
    },
    {
        id: 'susun_kata',
        title: 'Susun Kata',
        file: 'susunkata.html'
    }
]

function readGame(file) {
    const filePath = path.join(markupPath, file)

    if (!fs.existsSync(filePath)) {
        throw new Error(`Game HTML tidak ditemukan: ${filePath}`)
    }

    return fs.readFileSync(filePath, 'utf8')
}

const handler = async (m, { conn, notifReply }) => {
    try {
        const foad = new Foad2(conn, {
            dynamic: true
        })

        foad
            .addTitle('CLICK MEE!!!!!')
            .setPreviewTitle('Game Center')

        for (const game of games) {
            const html = readGame(game.file)

            foad.addHtml(html, {
                id: game.id,
                title: game.title,
                url: 'https://www.kyyinfinite.my.id',
                trustedSources: ['www.kyyinfinite.my.id']
            })
        }

        await foad.send(m.chat)

    } catch (error) {
        console.error('[GameBrain]', error)

        if (typeof notifReply === 'function') {
            await notifReply(
                `Error: ${error.message}`,
                'GameBrain Error'
            )
        }
    }
}

handler.command = ['gamebrain', 'games']
handler.help = ['gamebrain']
handler.tags = ['game']

export default handler