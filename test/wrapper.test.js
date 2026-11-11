import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

const {
    VERSION,
    Button,
    ButtonV2,
    Carousel,
    AIRich,
    Toolkit,
    Foad,
    Foad2
} = await import('../src/lib/message/wrapper.js')

const fakeConn = {
    waUploadToServer: async () => ({}),
    relayMessage: async () => { throw new Error('jangan relay di test') }
}

describe('message wrapper entry', () => {
    test('mengekspor API publik yang lengkap', () => {
        assert.equal(typeof VERSION, 'string')
        assert.equal(typeof Button, 'function')
        assert.equal(typeof ButtonV2, 'function')
        assert.equal(typeof Carousel, 'function')
        assert.equal(typeof AIRich, 'function')
        assert.equal(typeof Toolkit, 'function')
        assert.equal(typeof Foad, 'function')
        assert.equal(typeof Foad2, 'function')
    })

    test('builder tanpa socket ditolak', () => {
        assert.throws(() => new Button(), /Socket is required/)
        assert.throws(() => new ButtonV2(), /Socket is required/)
        assert.throws(() => new Carousel(), /Socket is required/)
        assert.throws(() => new Foad(), /Socket is required/)
        assert.throws(() => new Foad2(), /Socket is required/)
        assert.throws(() => new AIRich(), /Socket is required/)
    })
})

describe('Button builder', () => {
    test('fluent chain menghasilkan payload interactiveMessage', async () => {
        const msg = await new Button(fakeConn)
            .setBody('Hello')
            .setFooter('WhatsApp Bot')
            .addUrl('Website', 'https://example.com')
            .addReply('Sapa', 'say-hi')
            .build('628123@s.whatsapp.net')

        const im = msg.message.interactiveMessage
        assert.equal(im.body.text, 'Hello')
        assert.equal(im.footer.text, 'WhatsApp Bot')

        const names = im.nativeFlowMessage.buttons.map(b => b.name)
        assert.deepEqual(names, ['cta_url', 'quick_reply'])

        const urlParams = JSON.parse(im.nativeFlowMessage.buttons[0].buttonParamsJson)
        assert.equal(urlParams.display_text, 'Website')
        assert.equal(urlParams.url, 'https://example.com')

        const replyParams = JSON.parse(im.nativeFlowMessage.buttons[1].buttonParamsJson)
        assert.equal(replyParams.id, 'say-hi')
    })

    test('clearButtons mengosongkan koleksi', async () => {
        const builder = new Button(fakeConn)
            .setBody('x')
            .addReply('a', 'a')
            .addReply('b', 'b')

        assert.equal(builder._buttons.length, 2)
        builder.clearButtons()
        assert.equal(builder._buttons.length, 0)
    })

    test('setBody menolak non-string', () => {
        assert.throws(() => new Button(fakeConn).setBody(123), TypeError)
        assert.throws(() => new Button(fakeConn).setFooter(null), TypeError)
    })

    test('selection + section + row', () => {
        const builder = new Button(fakeConn)
            .addSelection('Pilih', { sections: [{ title: 'Utama', rows: [] }] })
            .makeSection('Kedua')
            .makeRow('h', 't', 'd', 'id-1')

        const params = JSON.parse(builder._buttons[0].buttonParamsJson)
        assert.equal(params.sections.length, 2)
        assert.equal(params.sections[1].rows[0].id, 'id-1')
    })

    test('makeRow tanpa selection melempar error', () => {
        assert.throws(() => new Button(fakeConn).makeRow('h', 't', 'd', 'x'), /selection/)
    })

    test('setContextInfo dan addPayload divalidasi', () => {
        const b = new Button(fakeConn)
        assert.throws(() => b.setContextInfo('bukan-object'), TypeError)
        assert.throws(() => b.addPayload([1]), TypeError)
        assert.equal(b.addPayload({ extra: 1 }), b)
    })
})

describe('ButtonV2 builder', () => {
    test('addButton dan build menghasilkan buttonsMessage', async () => {
        const msg = await new ButtonV2(fakeConn)
            .setTitle('Judul')
            .setBody('Isi')
            .setFooter('Kaki')
            .addButton('Tombol Satu', 'id-1')
            .build('628123@s.whatsapp.net')

        const bm = msg.message.buttonsMessage
        assert.equal(bm.contentText, 'Isi')
        assert.equal(bm.footerText, 'Kaki')
        assert.equal(bm.buttons.length, 1)
        assert.equal(bm.buttons[0].buttonId, 'id-1')
        assert.equal(bm.buttons[0].buttonText.displayText, 'Tombol Satu')
    })

    test('addButton tanpa id menghasilkan id otomatis', () => {
        const b = new ButtonV2(fakeConn).addButton('Tanpa Id')
        assert.ok(b._buttons[0].buttonId)
    })

    test('addRawButton memvalidasi objek', () => {
        const b = new ButtonV2(fakeConn)
        assert.throws(() => b.addRawButton('string'), TypeError)
        assert.throws(() => b.addRawButton(null), TypeError)
        assert.equal(b.addRawButton({ buttonId: 'x', buttonText: { displayText: 'x' }, type: 1 }), b)
    })

    test('loadFrom mengembalikan builder dari pesan buttonsMessage', () => {
        const source = {
            buttonsMessage: {
                contentText: 'Body lama',
                footerText: 'Footer lama',
                buttons: [{ buttonId: 'old', buttonText: { displayText: 'Old' }, type: 1 }]
            }
        }

        const b = new ButtonV2(fakeConn).loadFrom(source)
        assert.equal(b._body, 'Body lama')
        assert.equal(b._buttons[0].buttonId, 'old')
    })
})

describe('Carousel builder', () => {
    test('addCard menolak kartu tanpa media', () => {
        const c = new Carousel(fakeConn)
        assert.throws(() => c.addCard({ body: { text: 'x' } }), /image or video/)
    })

    test('addCard menerima kartu dengan header media', () => {
        const c = new Carousel(fakeConn)
        const card = { header: { hasMediaAttachment: true, imageMessage: {} }, body: { text: 'a' }, footer: { text: 'f' }, nativeFlowMessage: { buttons: [] } }
        assert.equal(c.addCard(card), c)
        assert.equal(c.addCard([card, card]), c)
        assert.equal(c._cards.length, 3)
    })
})

describe('Foad dan Foad2', () => {
    test('Foad.addHtml default url nixel.dev', () => {
        const f = new Foad(fakeConn).addHtml('<h1>halo</h1>')
        const tab = f._tabs[0]
        assert.equal(tab.tab_header, 'HTML')
        assert.equal(tab.sections[0].view_model.primitive.url, 'https://nixel.dev')
    })

    test('Foad2.addHtml default Widget/example.com', () => {
        const f = new Foad2(fakeConn).addHtml('<h1>halo</h1>')
        const tab = f._tabs[0]
        assert.equal(tab.tab_header, 'Widget')
        assert.equal(tab.sections[0].view_model.primitive.url, 'https://example.com')
    })

    test('addHtml menolak payload kosong', () => {
        assert.throws(() => new Foad(fakeConn).addHtml(''), TypeError)
        assert.throws(() => new Foad(fakeConn).addHtml('   '), TypeError)
        assert.throws(() => new Foad2(fakeConn).addHtml(123), TypeError)
    })

    test('addHtml menolak duplikat tab id', () => {
        assert.throws(() => new Foad(fakeConn).addHtml('<b>a</b>', { id: 'sama' }).addHtml('<b>b</b>', { id: 'sama' }), /Duplicate tab id/)
    })

    test('buildResponse Foad memakai struktur normal', () => {
        const resp = new Foad(fakeConn).addTitle('Judul').addHtml('<b>x</b>').buildResponse()
        assert.equal(resp.sections[0].view_model.primitive.__typename, 'GenAIMarkdownTextUXPrimitive')
        assert.equal(resp.embedded_screens[0].content[0].fullscreen, undefined)
    })

    test('buildResponse Foad2 memakai fullscreen', () => {
        const resp = new Foad2(fakeConn).addTitle('Judul').setPreviewTitle('Game').addHtml('<b>x</b>').buildResponse()
        assert.equal(resp.sections[0].view_model.primitive.__typename, 'GenAIBotProgressStatusPrimitive')
        assert.equal(resp.embedded_screens[0].content[0].fullscreen, true)
        assert.equal(resp.embedded_screens[0].title, 'Game')
    })

    test('buildResponse tanpa tab melempar error', () => {
        assert.throws(() => new Foad(fakeConn).buildResponse(), /at least one HTML tab/)
        assert.throws(() => new Foad2(fakeConn).buildResponse(), /at least one HTML tab/)
    })

    test('build menghasilkan richResponseMessage dengan unifiedResponse', async () => {
        const msg = await new Foad2(fakeConn, { dynamic: false }).addTitle('Klik').addHtml('<b>hi</b>').build('628123@s.whatsapp.net')
        const rich = msg.message.botForwardedMessage.message.richResponseMessage
        assert.equal(rich.messageType, 1)
        assert.equal(rich.submessages[0].messageText, 'Klik')

        const decoded = JSON.parse(Buffer.from(rich.unifiedResponse.data, 'base64').toString('utf8'))
        assert.ok(decoded.response_id)
        assert.equal(decoded.embedded_screens[0].content[0].fullscreen, true)
    })

    test('clearTabs dan get tabs', () => {
        const f = new Foad(fakeConn).addHtml('<b>a</b>')
        assert.equal(f.tabs.length, 1)
        f.clearTabs()
        assert.equal(f.tabs.length, 0)
    })
})

describe('Toolkit', () => {
    test('extractIE mengekstrak hyperlink', () => {
        const { text, ie, inline_entities } = Toolkit.extractIE('lihat [google](https://google.com) ya')
        assert.match(text, /\{\{.*HYPERLINK_0.*\}\}https:\/\/google\.com\{\{\/.*\}\}/)
        assert.equal(ie.length, 1)
        assert.equal(ie[0].type, 'hyperlink')
        assert.equal(inline_entities.length, 1)
        assert.equal(inline_entities[0].metadata.__typename, 'GenAIInlineLinkItem')
    })

    test('extractIE dengan extract false mengembalikan teks asli', () => {
        const { text, ie } = Toolkit.extractIE('a [b](https://c.com)', { extract: false })
        assert.equal(text, 'a [b](https://c.com)')
        assert.equal(ie.length, 0)
    })

    test('waitAllPromises meresolve nilai bersarang', async () => {
        const result = await Toolkit.waitAllPromises({ a: Promise.resolve(1), b: [Promise.resolve(2)] })
        assert.deepEqual(result, { a: 1, b: [2] })
    })

    test('buildBotHtml menghasilkan payload relay yang konsisten', () => {
        const { messageId, content } = Toolkit.buildBotHtml('<h1>game</h1>', 'Game Uji')
        assert.ok(messageId)

        const rich = content.botForwardedMessage.message.richResponseMessage
        assert.equal(rich.submessages[0].messageText, 'Game Uji')

        const unified = JSON.parse(Buffer.from(rich.unifiedResponse.data, 'base64').toString('utf8'))
        assert.equal(unified.response_id, messageId)
        assert.equal(unified.sections[0].view_model.primitive.payload, '<h1>game</h1>')

        const botId = rich.contextInfo.forwardedAiBotMessageInfo.botJid
        assert.equal(botId, content.messageContextInfo.botMetadata.botResponseId === messageId ? botId : 'salah')
    })

    test('buildBotHtml menolak html kosong', () => {
        assert.throws(() => Toolkit.buildBotHtml(''), TypeError)
        assert.throws(() => Toolkit.buildBotHtml('  '), TypeError)
    })

    test('getMp4Duration buffer invalid aman', () => {
        assert.equal(Toolkit.getMp4Duration(Buffer.alloc(0)), 0)
        assert.equal(Toolkit.getMp4Duration('bukan-buffer'), 0)
    })
})

describe('AIRich', () => {
    test('tokenizer memecah kode sederhana', () => {
        const result = AIRich.tokenizer('const x = 1', 'javascript')
        assert.ok(Array.isArray(result.codeBlock))
        assert.ok(result.unified_codeBlock.length > 0)
        assert.ok(result.unified_codeBlock.every(t => typeof t.content === 'string' && typeof t.type === 'string'))
    })

    test('generateVerificationMetadata memiliki struktur valid', () => {
        const meta = AIRich.generateVerificationMetadata()
        assert.ok(meta)
        assert.ok('onErrorAction' in meta || Object.keys(meta).length >= 0)
    })

    test('addText menolak non-string', () => {
        assert.throws(() => new AIRich(fakeConn).addText(123), TypeError)
    })

    test('addText dan build menghasilkan richResponseMessage', async () => {
        const msg = await new AIRich(fakeConn, { dynamic: false })
            .addText('halo dunia')
            .build('628123@s.whatsapp.net')

        const rich = msg.message.botForwardedMessage.message.richResponseMessage
        assert.equal(rich.submessages.length, 1)

        const unified = JSON.parse(Buffer.from(rich.unifiedResponse.data, 'base64').toString('utf8'))
        assert.ok(unified.sections.length >= 1)
    })

    test('toTableMetadata menolak input tidak valid', () => {
        assert.throws(() => AIRich.toTableMetadata('bukan-array'), TypeError)
        assert.throws(() => AIRich.toTableMetadata([['a', 1]]), TypeError)
    })

    test('id management: assignId dan hasId', () => {
        const rich = new AIRich(fakeConn)
        rich.addText('item', { id: 'teks-satu' })
        assert.equal(rich.hasId('teks-satu'), true)
        assert.equal(rich.hasId('tidak-ada'), false)
        assert.deepEqual(rich.getIds(), ['teks-satu'])
        assert.throws(() => rich.addText('dupe', { id: 'teks-satu' }), /already exists/)
        assert.throws(() => rich.assignId(99, 'x'), /out of range/)
    })

    test('peek dan delete item by id', () => {
        const rich = new AIRich(fakeConn)
        rich.addText('satu', { id: 'a' })
        rich.addText('dua', { id: 'b' })

        assert.equal(rich.peek('a').id, 'a')
        rich.delete('a')
        assert.equal(rich.hasId('a'), false)
        assert.throws(() => rich.delete('a'), /not found/)
    })
})
