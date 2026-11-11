import path from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { runtime } from '../../src/utils/myfunc.js'
import { ButtonV2 } from '../../src/lib/message/wrapper.js'
import { getMenuData } from '../../src/services/menu-engine.js'
import { getHelpData } from '../../src/services/help/engine.js'
import { getConfig } from '../../src/services/config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const thumbPath = path.join(__dirname, '../../src/assets/media/thumb.jpg')

const renderCategory = (category) => {
    const lines = category.commands
        .map(c => `*/${c.command}* — ${c.description}`)
        .join('\n')

    return `\`[ ${category.title.toUpperCase()} ]\`\n\n${lines || 'Belum ada command terdaftar.'}`
}

const renderHelpOverview = (data) =>
    `\`[ PUSAT BANTUAN ]\`\n\n` +
    data.sections.map(section => `*/help ${section.id}* — ${section.title}`).join('\n') +
    `\n\nKirim *.help <bagian>* untuk membuka panduan.`

const renderHelpSection = (section) => {
    const items = section.items.map(item => {
        const [title, description, examples] = item
        let block = `• *${title}*`
        if (description) block += `\n${description}`
        if (Array.isArray(examples) && examples.length) {
            block += '\n' + examples.map(([cmd, desc]) => `  - \`${cmd}\`${desc ? ` — ${desc}` : ''}`).join('\n')
        }
        return block
    }).join('\n\n')

    return `\`[ ${section.title.toUpperCase()} ]\`\n_${section.sub}_\n\n${items}`
}

let handler = async (m, { conn, prefix, command, text }) => {
    try {
        const config = getConfig()
        const pushname = m.pushName || 'No Name'
        const thumb = await sharp(thumbPath).resize(300, 300).jpeg({ quality: 80 }).toBuffer()

        if (command === 'help') {
            const data = getHelpData(text)
            const section = data.sections.find(s => s.id === data.selected)
            const body = section ? renderHelpSection(section) : renderHelpOverview(data)
            await m.reply(body)
            return
        }

        const menu = getMenuData({
            isOwner: m.isOwner,
            isCreator: m.isCreator,
            isPremium: m.isPremium,
            isGroup: m.isGroup,
            isAdmin: m.isAdmin,
            isBotAdmin: m.isBotAdmin
        })

        if (command !== 'menu') {
            const selected = menu.categories.find(category => category.id === command)

            if (selected) {
                await new ButtonV2(conn)
                    .setTitle(config.botName || 'WhatsApp Bot')
                    .setSubtitle(`${selected.title} Menu`)
                    .setBody(renderCategory(selected))
                    .setThumbnail(thumb)
                    .addRawButton({
                        buttonText: { displayText: 'Back to Menu' },
                        buttonId: 'menu',
                        type: 1
                    })
                    .send(m.chat, { quoted: m })

                return
            }
        }

        const msg = `*haloo ${pushname}*`

        const anu = `
\`"</>"  ${config.botName || 'whatsapp-bot'}.system\`

const bot = {
  creator : "${config.ownerName || 'kyyinfinite'}",
  name    : "${config.botName || 'kyyinfinite'}",
  baileys : "@whiskeysockets/baileys",
  type    : "plugins (esm)",
  prefix  : "multi",
  status  : "${m.isCreator ? 'owner' : m.isPremium ? 'premium' : 'user free'}",
  mode    : "${config.botMode === 'public' ? 'public' : 'self'}",
  uptime  : "${runtime(process.uptime())}"
}

\`"</>"  commands\`

Pilih kategori menu di bawah.
`.trim()

        const rows = menu.categories.map(category => ({
            title: category.title,
            description: category.description,
            id: `${prefix}${category.id}`
        }))

        const sections = [{ title: 'Command Categories', rows }]

        const paramsJson = JSON.stringify({
            title: 'Pilih Menu',
            sections
        })

        await new ButtonV2(conn)
            .setTitle(config.botName || 'WhatsApp Bot')
            .setSubtitle('Command Center')
            .setBody(msg)
            .setFooter(anu)
            .setThumbnail(thumb)
            .addRawButton({
                buttonText: { displayText: 'Pilih Menu' },
                buttonId: 'menuselect',
                type: 1,
                nativeFlowInfo: {
                    name: 'single_select',
                    paramsJson
                }
            })
            .addButton('Bantuan', `${prefix}help`)
            .send(m.chat, { quoted: m })
    } catch (error) {
        console.error('[MENU ERROR]', error)

        if (typeof m.reply === 'function') {
            await m.reply(`Menu gagal ditampilkan.\n\n${error.message}`)
        }
    }
}

handler.command = ['menu', 'help', 'general', 'game', 'snippet', 'owner', 'system']
handler.help = ['menu', 'help']
handler.tags = ['main']
handler.description = 'Menampilkan daftar fitur bot dan pusat bantuan'

export default handler
