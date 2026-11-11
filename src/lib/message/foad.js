import crypto from 'crypto'
import { generateWAMessageFromContent, generateMessageIDV2 } from '@whiskeysockets/baileys'
import { BaseBuilder } from './base-builder.js'
import { AIRich } from './airich.js'

const BOT_JID = '867051314767696@bot'

class FoadBase extends BaseBuilder {
    #client;

    constructor(client, { dynamic = true, defaults = {} } = {}) {
        super();

        if (!client) {
            throw new Error('Socket is required');
        }

        this.#client = client;

        this._dynamic = !!dynamic;
        this._messageText = '';
        this._previewTitle = 'Preview';
        this._tabs = [];

        this._defaults = {
            htmlTitle: 'HTML',
            htmlUrl: 'https://example.com',
            htmlTrustedSources: ['example.com'],
            tabHeader: 'HTML',
            ...defaults,
        };

        this._responseId = crypto.randomUUID();
        this._botResponseId = crypto.randomUUID();

        this._lastMessageKey = null;
    }

    setResponseId(id) {
        if (!id || typeof id !== 'string') {
            throw new TypeError('Response ID must be a non-empty string');
        }

        this._responseId = id;

        return this;
    }

    refreshResponseId() {
        this._responseId = crypto.randomUUID();

        return this;
    }

    setBotResponseId(id) {
        if (!id || typeof id !== 'string') {
            throw new TypeError('Bot response ID must be a non-empty string');
        }

        this._botResponseId = id;

        return this;
    }

    refreshBotResponseId() {
        this._botResponseId = crypto.randomUUID();

        return this;
    }

    addTitle(text) {
        if (typeof text !== 'string') {
            throw new TypeError('Title must be a string');
        }

        this._messageText = text;

        return this;
    }

    setPreviewTitle(title) {
        if (typeof title !== 'string') {
            throw new TypeError('Preview title must be a string');
        }

        this._previewTitle = title;

        return this;
    }

    addHtml(
        html,
        {
            title = this._defaults.htmlTitle,
            id,
            url = this._defaults.htmlUrl,
            trustedSources = this._defaults.htmlTrustedSources,
            stepEntries = []
        } = {}
    ) {
        if (typeof html !== 'string' || !html.trim()) {
            throw new TypeError('HTML payload must be a non-empty string');
        }

        if (typeof title !== 'string') {
            throw new TypeError('Tab title must be a string');
        }

        if (typeof url !== 'string') {
            throw new TypeError('URL must be a string');
        }

        if (!Array.isArray(trustedSources)) {
            throw new TypeError('trustedSources must be an array');
        }

        if (!Array.isArray(stepEntries)) {
            throw new TypeError('stepEntries must be an array');
        }

        const tabId = id ?? `tab_${this._tabs.length}`;

        if (typeof tabId !== 'string' || !tabId) {
            throw new TypeError('Tab id must be a non-empty string');
        }

        if (this._tabs.some(tab => tab.id === tabId)) {
            throw new Error(`Duplicate tab id: ${tabId}`);
        }

        this._tabs.push({
            id: tabId,
            tab_header: title,

            sections: [
                {
                    __typename: 'GenAIUnifiedResponseSection',

                    view_model: {
                        __typename: 'GenAISingleLayoutViewModel',

                        primitive: {
                            __typename: 'GenAIaeacdsnwHtmlPrimitive',

                            payload: html,

                            url,

                            trusted_sources: trustedSources
                        }
                    }
                }
            ],

            step_entries: stepEntries
        });

        return this;
    }

    addTab(tab = {}) {
        const {
            id,
            tab_header = this._defaults.tabHeader,
            sections = [],
            step_entries = []
        } = tab;

        if (!id || typeof id !== 'string') {
            throw new TypeError('Tab id must be a non-empty string');
        }

        if (typeof tab_header !== 'string') {
            throw new TypeError('Tab header must be a string');
        }

        if (this._tabs.some(item => item.id === id)) {
            throw new Error(`Duplicate tab id: ${id}`);
        }

        if (!Array.isArray(sections)) {
            throw new TypeError('Tab sections must be an array');
        }

        if (!Array.isArray(step_entries)) {
            throw new TypeError('Tab step_entries must be an array');
        }

        this._tabs.push({
            id,
            tab_header,
            sections: structuredClone(sections),
            step_entries: structuredClone(step_entries)
        });

        return this;
    }

    clearTabs() {
        this._tabs = [];

        return this;
    }

    get tabs() {
        return structuredClone(this._tabs);
    }

    buildResponse() {
        throw new Error('buildResponse() must be implemented by subclass');
    }

    async build(
        jid,
        {
            messageId,
            ...options
        } = {}
    ) {
        const responseData =
            this.buildResponse();

        const dataBase64 =
            Buffer
                .from(
                    JSON.stringify(responseData)
                )
                .toString('base64');

        return generateWAMessageFromContent(
            jid,

            {
                messageContextInfo: {
                    deviceListMetadata: {},

                    deviceListMetadataVersion: 2,

                    botMetadata: {
                        messageDisclaimerText:
                            this._title || '',

                        botResponseId:
                            this._botResponseId,

                        verificationMetadata:
                            AIRich.generateVerificationMetadata()
                    }
                },

                ...this._extraPayload,

                botForwardedMessage: {
                    message: {
                        richResponseMessage: {
                            messageType: 1,

                            submessages:
                                this._messageText
                                    ? [
                                        {
                                            messageType: 2,

                                            messageText:
                                                this._messageText
                                        }
                                    ]
                                    : [],

                            unifiedResponse: {
                                data: dataBase64
                            },

                            contextInfo: {
                                forwardingScore: 1,

                                isForwarded: true,

                                forwardedAiBotMessageInfo: {
                                    botJid: BOT_JID
                                },

                                forwardOrigin: 4
                            }
                        }
                    }
                }
            },

            {
                messageId:
                    messageId ||
                    generateMessageIDV2(),

                ...options
            }
        );
    }

    async send(
        jid,
        {
            messageId,
            ...options
        } = {}
    ) {
        const msg =
            await this.build(
                jid,
                {
                    messageId,
                    ...options
                }
            );

        await this.#client.relayMessage(
            msg.key.remoteJid,

            msg.message,

            {
                messageId: msg.key.id,

                ...options
            }
        );

        this._lastMessageKey = msg.key;

        return msg;
    }

    async sendEdit(
        jid,
        id,
        {
            msg,
            messageId,
            ...options
        } = {}
    ) {
        jid =
            jid ??
            this._lastMessageKey?.remoteJid;

        id =
            id ??
            this._lastMessageKey?.id;

        if (!jid) {
            throw new Error('JID is required');
        }

        if (!id) {
            throw new Error('Message id is required');
        }

        const source =
            msg ??
            (
                await this.build(
                    jid,
                    options
                )
            ).message;

        const editedMessage =
            await generateWAMessageFromContent(
                jid,

                {
                    botForwardedMessage: {
                        message: {
                            protocolMessage: {
                                key: {
                                    remoteJid: jid,

                                    fromMe: true,

                                    id
                                },

                                type: 14,

                                editedMessage:
                                    source
                            }
                        }
                    }
                },

                {
                    messageId:
                        messageId ||
                        generateMessageIDV2(),

                    ...options
                }
            );

        await this.#client.relayMessage(
            jid,

            editedMessage.message,

            {
                messageId:
                    editedMessage.key.id
            }
        );

        return editedMessage;
    }
}

export class Foad extends FoadBase {
    constructor(client, { dynamic = true } = {}) {
        super(client, {
            dynamic,
            defaults: {
                htmlTitle: 'HTML',
                htmlUrl: 'https://nixel.dev',
                htmlTrustedSources: ['nixel.dev'],
                tabHeader: 'HTML'
            }
        });
    }

    buildResponse() {
        if (!this._tabs.length) {
            throw new Error('Foad requires at least one HTML tab');
        }

        if (this._dynamic) {
            this.refreshResponseId();
            this.refreshBotResponseId();
        }

        return {
            response_id: this._responseId,

            sections: [
                {
                    view_model: {
                        primitive: {
                            text: this._messageText,

                            __typename:
                                'GenAIMarkdownTextUXPrimitive'
                        },

                        __typename:
                            'GenAISingleLayoutViewModel'
                    }
                }
            ],

            embedded_screens: [
                {
                    title: this._previewTitle,

                    content: [
                        {
                            __typename:
                                'FOAIDNixelButtonSheets',

                            tabs: structuredClone(
                                this._tabs
                            )
                        }
                    ]
                }
            ]
        };
    }
}

export class Foad2 extends FoadBase {
    constructor(client, { dynamic = true } = {}) {
        super(client, {
            dynamic,
            defaults: {
                htmlTitle: 'Widget',
                htmlUrl: 'https://example.com',
                htmlTrustedSources: ['example.com'],
                tabHeader: 'Widget'
            }
        });
    }

    buildResponse() {
        if (!this._tabs.length) {
            throw new Error('Foad2 requires at least one HTML tab');
        }

        if (this._dynamic) {
            this.refreshResponseId();
            this.refreshBotResponseId();
        }

        return {
            response_id: this._responseId,

            sections: [
                {
                    __typename:
                        'GenAIUnifiedResponseSection',

                    view_model: {
                        __typename:
                            'GenAISingleLayoutViewModel',

                        primitive: {
                            __typename:
                                'GenAIBotProgressStatusPrimitive',

                            title:
                                this._messageText ||
                                'Popioo:*Click Me*',

                            is_in_progress: true
                        }
                    }
                }
            ],

            embedded_screens: [
                {
                    title: this._previewTitle,

                    content: [
                        {
                            __typename:
                                'FOAIDNixelButtonSheets',

                            display_mode: 'fullscreen',

                            fullscreen: true,

                            tabs: structuredClone(
                                this._tabs
                            )
                        }
                    ]
                }
            ]
        };
    }
}
