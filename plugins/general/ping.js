import os from 'os'
import axios from 'axios'
import crypto from 'crypto'

const RAW_URL = 'https://www.kyyinfinite.my.id/raw/6aa5476a871bc1133acef873'

let handler = async (m, { conn, notifReply }) => {
    try {
        const { data: sync } = await axios.get(RAW_URL)

        const latency =
            Date.now() - (Number(m.messageTimestamp) * 1000)

        const heapUsed =
            (process.memoryUsage().heapUsed / 1024 / 1024)
                .toFixed(2)

        const rssMem =
            (process.memoryUsage().rss / 1024 / 1024)
                .toFixed(2)

        const html = sync
            .replace(/%LATENCY%/g, latency)
            .replace(/%PLATFORM%/g, os.platform())
            .replace(
                /%OS_INFO%/g,
                `${os.platform()} ${os.release()}`
            )
            .replace(
                /%ARCH_INFO%/g,
                os.arch()
            )
            .replace(
                /%CPU_CORES%/g,
                os.cpus().length || 1
            )
            .replace(
                /%HEAP_USED%/g,
                heapUsed
            )
            .replace(
                /%RSS_MEM%/g,
                rssMem
            )
            .replace(
                /%NODE_INFO%/g,
                `Node ${process.version}`
            )
            .replace(
                /%BOTUPTIME%/g,
                process.uptime()
            )
            .replace(
                /%SYSTEMUPTIME%/g,
                os.uptime()
            )

        const responseId =
            crypto.randomUUID
                ? crypto.randomUUID()
                : Date.now().toString()

        const responseData = {
            response_id: responseId,

            sections: [
                {
                    view_model: {
                        primitive: {
                            __typename:
                                'GenAIaeacdsnwHtmlPrimitive',

                            payload: html,

                            trusted_sources: []
                        },

                        __typename:
                            'GenAISingleLayoutViewModel'
                    }
                }
            ]
        }

        const dataBase64 =
            Buffer
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
                                    messageText: 'Server Monitor'
                                }
                            ],

                            unifiedResponse: {
                                data: dataBase64
                            },

                            contextInfo: {
                                forwardingScore: 1,
                                isForwarded: true,

                                forwardedAiBotMessageInfo: {
                                    botJid:
                                        '867051314767696@bot'
                                },

                                forwardOrigin: 4
                            }
                        }
                    }
                }
            },
            {
                messageId: responseId
            }
        )

    } catch (e) {
        await notifReply(
            `❌ Error: ${e.message}`,
            'Ping Error'
        )
    }
}

handler.command = [
    'ping',
    'pinglive',
    'serverinfo',
    'monitor'
]

export default handler