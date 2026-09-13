import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { runtime } from '../../src/utils/myfunc.js'
import { ButtonV2 } from '../../src/lib/message/wrapper.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const configPath = path.join(__dirname, '../../config.json')
const thumbPath = path.join(__dirname, '../../src/assets/media/thumb.jpg')

const handler = async (m, { conn, prefix, command }) => {
    try {
        const config = JSON.parse(
            fs.readFileSync(configPath, 'utf8')
        )

        const pushname = m.pushName || 'No Name'

        const thumb = await sharp(thumbPath)
            .resize(300, 300)
            .jpeg({ quality: 80 })
            .toBuffer()

        const categories = [
            {
                id: 'ownermenu',
                title: 'Owner',
                description: 'Perintah khusus owner'
            },
            {
                id: 'premiummenu',
                title: 'Premium',
                description: 'Perintah pengguna premium'
            },
            {
                id: 'systemmenu',
                title: 'System',
                description: 'Perintah sistem bot'
            },
            {
                id: 'gamemenu',
                title: 'Game',
                description: 'Game dan hiburan'
            },
            {
                id: 'toolsmenu',
                title: 'Tools',
                description: 'Tools dan utilities'
            }
        ]


        if (command && command !== 'menu' && command !== 'help') {

            const selected = categories.find(
                x => x.id === command
            )

            if (selected) {

                const categoryText = {
                    ownermenu: `
\`[ OWNER ]\`

*/addowner*
*/delowner*
*/setbotname*
*/setprefix*
*/self*
*/public*
`,

                    premiummenu: `
\`[ PREMIUM ]\`

*/addprem*
*/delprem*
*/listprem*
`,

                    systemmenu: `
\`[ SYSTEM ]\`

*/ping*
*/status*
*/sc*
*/restart*
`,

                    gamemenu: `
\`[ GAME ]\`

*/asahotak*
*/susunkata*
*/pengetahuan*
*/catur*
*/tictactoe*
`,

                    toolsmenu: `
\`[ TOOLS ]\`

*/sticker*
*/toimg*
*/translate*
*/shorturl*
`
                }

                const text = categoryText[command] || `
\`[ ${selected.title.toUpperCase()} ]\`

Belum ada command.
`

                const categoryButton = new ButtonV2(conn)

                await categoryButton
                    .setTitle(config.botName || 'kyyinfinite')
                    .setSubtitle(`${selected.title} Menu`)
                    .setBody(text)
                    .setThumbnail(thumb)
                    .addRawButton({
                        buttonText: {
                            displayText: 'Back to Menu'
                        },
                        buttonId: 'menu',
                        type: 1
                    })
                    .send(m.chat, {
                        quoted: m
                    })

                return
            }
        }


        const msg = `*haloo ${pushname}*`

        const anu = `
\`"</>"  kyyinfinite.system\`

const bot = {
  creator : "kyyinfinite",
  name    : "${config.botName || 'kyyinfinite'}",
  baileys : "npm:kyyinfinite",
  type    : "plugins (esm)",
  prefix  : "multi",
  status  : "${m.isCreator ? 'owner' : m.isPremium ? 'premium' : 'user free'}",
  mode    : "${config.botMode === 'public' ? 'public' : 'self'}",
  uptime  : "${runtime(process.uptime())}"
}

\`"</>"  commands\`

Pilih kategori menu di bawah.
`

        const rows = categories.map(category => ({
            title: category.title,
            description: category.description,
            id: `${prefix}${category.id}`
        }))

        const sections = [
            {
                title: 'Command Categories',
                rows
            }
        ]

        const paramsJson = JSON.stringify({
            title: 'Pilih Menu',
            sections
        })

        const button = new ButtonV2(conn)

        await button
            .setTitle(config.botName || 'kyyinfinite')
            .setSubtitle('Command Center')
            .setBody(`${msg}\n${anu}`)
            .setThumbnail(thumb)

            .addRawButton({
                buttonText: {
                    displayText: 'Pilih Menu'
                },
                buttonId: 'menuselect',
                type: 1,
                nativeFlowInfo: {
                    name: 'single_select',
                    paramsJson
                }
            })
            .addButton(
                'Script',
                `${prefix}sc`
            )

            .send(m.chat, {
                quoted: m
            })

    } catch (error) {
        console.error('[MENU ERROR]', error)

        if (typeof m.reply === 'function') {
            await m.reply(
                `Menu gagal ditampilkan.\n\n${error.message}`
            )
        }
    }
}

handler.command = [
    'menu',
    'help',
    'ownermenu',
    'premiummenu',
    'systemmenu',
    'gamemenu',
    'toolsmenu'
]

export default handler