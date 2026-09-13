import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import crypto from 'crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const htmlPath = path.join(__dirname, '../../src/assets/markup/asahotak.html')

let handler = async (m, { conn, notifReply }) => {
    try {
        const html = fs.readFileSync(htmlPath, 'utf8')

        const responseId = crypto.randomUUID
            ? crypto.randomUUID()
            : Date.now().toString()

        const responseData = {
            response_id: responseId,
            sections: [
                {
                    view_model: {
                        primitive: {
                            __typename: 'GenAIaeacdsnwHtmlPrimitive',
                            payload: html,
                            trusted_sources: []
                        },
                        __typename: 'GenAISingleLayoutViewModel'
                    }
                }
            ]
        }

        const dataBase64 = Buffer
            .from(JSON.stringify(responseData))
            .toString('base64')

        await conn.relayMessage(
            m.chat,
            {
                messageContextInfo: {
                    deviceListMetadata: {},
                    deviceListMetadataVersion: 2,
                    botMetadata: {
                        messageDisclaimerText: '',
                        botResponseId: responseId
                    }
                },
                botForwardedMessage: {
                    message: {
                        richResponseMessage: {
                            messageType: 1,
                            submessages: [
                                {
                                    messageType: 2,
                                    messageText: '🎮 asahotak'
                                }
                            ],
                            unifiedResponse: {
                                data: dataBase64
                            },
                            contextInfo: {
                                forwardingScore: 1,
                                isForwarded: true,
                                forwardedAiBotMessageInfo: {
                                    botJid: '867051314767696@bot'
                                },
                                forwardOrigin: 4
                            }
                        }
                    }
                }
            },
            { messageId: responseId }
        )
    } catch (e) {
        console.error(e)
        await notifReply(`❌ Error: ${e.message}`, 'asahotak Error')
    }
}

handler.command = ['asahotak']
handler.help = ['asahotak']
handler.tags = ['game']

export default handler