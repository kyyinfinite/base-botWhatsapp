import { normalizeMessageContent } from '@whiskeysockets/baileys'

export function extractCommandFromMessage(m) {
    let body = ''
    let isButtonResponse = false
    try {
        const content = normalizeMessageContent(m?.message) || m?.message
        if (content) {
            if (content.conversation) body = content.conversation
            else if (content.extendedTextMessage?.text) body = content.extendedTextMessage.text
            else if (content.imageMessage?.caption) body = content.imageMessage.caption
            else if (content.videoMessage?.caption) body = content.videoMessage.caption
            else if (content.documentMessage?.caption) body = content.documentMessage.caption
            else if (content.documentWithCaptionMessage?.message?.documentMessage?.caption) {
                body = content.documentWithCaptionMessage.message.documentMessage.caption
            }
            else if (content.interactiveResponseMessage) {
                const inter = content.interactiveResponseMessage
                if (inter.nativeFlowResponseMessage) {
                    const flow = inter.nativeFlowResponseMessage
                    if (flow.paramsJson) {
                        try {
                            const params = JSON.parse(flow.paramsJson)
                            body = params.id || params.buttonId || params.rowId || params.index || ''
                        } catch { body = flow.name || '' }
                    } else body = flow.name || ''
                    isButtonResponse = true
                } else if (inter.buttonReply) {
                    body = inter.buttonReply.selectedButtonId || ''
                    isButtonResponse = true
                } else if (inter.singleSelectReply) {
                    body = inter.singleSelectReply.selectedRowId || ''
                    isButtonResponse = true
                }
            } else if (content.templateButtonReplyMessage) {
                body = content.templateButtonReplyMessage.selectedId || ''
                isButtonResponse = true
            } else if (content.buttonsResponseMessage) {
                body = content.buttonsResponseMessage.selectedButtonId || ''
                isButtonResponse = true
            }
        }
    } catch (error) {
        console.error('Error parsing message:', error)
    }
    return { body, isButtonResponse }
}

export function normalizeMessage(m) {
    const { body, isButtonResponse } = extractCommandFromMessage(m)
    m.text = body
    m.isButtonResponse = isButtonResponse
    return m
}
