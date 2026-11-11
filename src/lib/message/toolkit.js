import crypto from 'crypto'
import sharp from 'sharp'
import ffmpeg from 'fluent-ffmpeg'
import { prepareWAMessageMedia } from '@whiskeysockets/baileys'
import { extractIE, waitAllPromises } from './utils.js'

const FETCH_TIMEOUT_MS = 30_000
const FETCH_MAX_BYTES = 50 * 1024 * 1024

export class Toolkit {
        constructor() {}

        static extractIE(text, { extract = true, hyperlink = true, citation = true, latex = true } = {}) {
                return extractIE(text, { extract, hyperlink, citation, latex });
        }

        static async resize(buffer, x, y, fit = 'cover') {
                return await sharp(buffer)
                        .resize(x, y, {
                                fit,
                                position: 'center',
                                background: { r: 0, g: 0, b: 0, alpha: 0 },
                        })
                        .png()
                        .toBuffer();
        }

        static async waitAllPromises(input) {
                return await waitAllPromises(input);
        }

        static async fetchBuffer(url, options = {}, { silent = true, timeout = FETCH_TIMEOUT_MS, maxBytes = FETCH_MAX_BYTES } = {}) {
                try {
                        const parsed = new URL(url)
                        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                                throw new Error(`Skema tidak didukung: ${parsed.protocol}`)
                        }

                        const signal = options.signal ?? AbortSignal.timeout(timeout)
                        const response = await fetch(url, { ...options, signal })
                        if (!response.ok) throw new Error(`HTTP ${response.status}`)

                        const declared = Number(response.headers.get('content-length'))
                        if (Number.isFinite(declared) && declared > maxBytes) {
                                throw new Error(`Ukuran melebihi batas: ${declared} > ${maxBytes}`)
                        }

                        if (!response.body) return Buffer.alloc(0)

                        const reader = response.body.getReader()
                        const chunks = []
                        let received = 0
                        for (;;) {
                                const { done, value } = await reader.read()
                                if (done) break
                                received += value.byteLength
                                if (received > maxBytes) {
                                        try { await reader.cancel() } catch {}
                                        throw new Error(`Ukuran melebihi batas: ${received} > ${maxBytes}`)
                                }
                                chunks.push(value)
                        }

                        return Buffer.concat(chunks)
                } catch (error) {
                        if (silent) return Buffer.alloc(0);
                        throw error;
                }
        }

        static async toUrl(_client, path, mediaType = 'document') {
                if (!path) throw new Error('Url or buffer needed');

                const media = await prepareWAMessageMedia(
                        {
                                [mediaType]: Buffer.isBuffer(path) ? path : { url: path },
                        },
                        {
                                upload: _client.waUploadToServer,
                                jid: '\u0040\u006e\u0065\u0077\u0073\u006c\u0065\u0074\u0074\u0065\u0072',
                        }
                );

                return Object.values(media)[0]?.url;
        }

        static async resolveMedia(_client, media, mediaType = 'image', { resolveUrl = false, resolveWAUrl = false, result = 'url', resize = false, width = 300, height = 300 } = {}) {
                const isUrl = (str) => /^https?:\/\/.+/i.test(str);

                const isWAUrl = (str) => /^https?:\/\/[^/]*\.whatsapp\.net\//i.test(str);

                if (Array.isArray(media)) {
                        return Promise.all(
                                media.map((item) =>
                                        Toolkit.resolveMedia(_client, item, mediaType, {
                                                resolveUrl,
                                                resolveWAUrl,
                                                result,
                                                resize,
                                                width,
                                                height,
                                        })
                                )
                        );
                }

                const originalIsBuffer = Buffer.isBuffer(media);

                if (typeof media === 'string' && isUrl(media)) {
                        if (isWAUrl(media)) {
                                if (resolveWAUrl) {
                                        media = await Toolkit.fetchBuffer(media, {}, { silent: true });
                                } else if (!resolveUrl) {
                                        if (result === 'url') return media;

                                        media = await Toolkit.fetchBuffer(media, {}, { silent: true });
                                }
                        } else {
                                if (!resolveUrl) {
                                        if (result === 'url') return media;

                                        media = await Toolkit.fetchBuffer(media, {}, { silent: true });
                                } else {
                                        media = await Toolkit.fetchBuffer(media, {}, { silent: true });
                                }
                        }
                }

                if (typeof media === 'string' && !isUrl(media)) {
                        media = Buffer.from(media, 'base64');
                }

                if (!Buffer.isBuffer(media) || !media.length) {
                        return;
                }

                if (resize && Buffer.isBuffer(media)) {
                        media = await Toolkit.resize(media, width, height);
                }

                if (result === 'buffer') {
                        return media;
                }

                if (result === 'base64') {
                        return media.toString('base64');
                }

                if (originalIsBuffer) {
                        return Toolkit.toUrl(_client, media, mediaType);
                }

                return Toolkit.toUrl(_client, media, mediaType);
        }

        static getMp4Duration(buffer, { silent = true } = {}) {
                try {
                        if (!Buffer.isBuffer(buffer) || buffer.length < 8) {
                                if (silent) return 0;
                                throw new Error('Invalid buffer');
                        }

                        let offset = 0;

                        while (offset < buffer.length - 8) {
                                const size = buffer.readUInt32BE(offset);

                                if (size < 8 || offset + size > buffer.length) {
                                        if (silent) return 0;
                                        throw new Error('Invalid atom size');
                                }

                                const type = buffer.toString('ascii', offset + 4, offset + 8);

                                if (type === 'moov') {
                                        let moovOffset = offset + 8;
                                        const moovEnd = offset + size;

                                        while (moovOffset < moovEnd - 8) {
                                                const childSize = buffer.readUInt32BE(moovOffset);

                                                if (childSize < 8 || moovOffset + childSize > moovEnd) {
                                                        if (silent) return 0;
                                                        throw new Error('Invalid child atom size');
                                                }

                                                const childType = buffer.toString('ascii', moovOffset + 4, moovOffset + 8);

                                                if (childType === 'mvhd') {
                                                        const version = buffer.readUInt8(moovOffset + 8);

                                                        if (version === 0) {
                                                                const timescale = buffer.readUInt32BE(moovOffset + 20);
                                                                const duration = buffer.readUInt32BE(moovOffset + 24);

                                                                if (!timescale) {
                                                                        if (silent) return 0;
                                                                        throw new Error('Invalid timescale');
                                                                }

                                                                return duration / timescale;
                                                        }

                                                        if (version === 1) {
                                                                const timescale = buffer.readUInt32BE(moovOffset + 32);
                                                                const duration = Number(buffer.readBigUInt64BE(moovOffset + 36));

                                                                if (!timescale) {
                                                                        if (silent) return 0;
                                                                        throw new Error('Invalid timescale');
                                                                }

                                                                return duration / timescale;
                                                        }
                                                }

                                                moovOffset += childSize;
                                        }
                                }

                                offset += size;
                        }

                        if (silent) return 0;

                        throw new Error('No mvhd found!');
                } catch (err) {
                        if (silent) return 0;
                        throw err;
                }
        }

        static getMp4Preview(videoBuffer, { time, result = 'buffer', resize = true, width = 300, height = 300, silent = true } = {}) {
                return new Promise((resolve, reject) => {
                        const fail = (err) => {
                                if (silent) {
                                        return resolve(result === 'base64' ? '' : Buffer.alloc(0));
                                }
                                return reject(err);
                        };

                        try {
                                if (!Buffer.isBuffer(videoBuffer) || !videoBuffer.length) {
                                        return fail(new Error('videoBuffer tidak valid atau kosong'));
                                }

                                const inputStream = new Readable({ read() {} });
                                inputStream.push(videoBuffer);
                                inputStream.push(null);

                                const outputStream = new PassThrough();
                                const chunks = [];

                                outputStream.on('data', (chunk) => chunks.push(chunk));

                                outputStream.on('end', async () => {
                                        try {
                                                let output = Buffer.concat(chunks);

                                                if (!output.length) {
                                                        return fail(new Error('Output kosong — cek format atau timestamp video'));
                                                }

                                                if (resize) {
                                                        output = await Toolkit.resize(output, width, height);
                                                }

                                                return resolve(result === 'base64' ? output.toString('base64') : output);
                                        } catch (err) {
                                                return fail(err);
                                        }
                                });

                                outputStream.on('error', fail);

                                time = time ?? Math.min(Toolkit.getMp4Duration(videoBuffer) * 0.2, 10);

                                ffmpeg(inputStream)
                                        .outputOptions([`-ss ${time}`, '-vframes 1', '-vcodec png', '-f image2pipe'])
                                        .on('error', (err) => fail(new Error(`ffmpeg error: ${err.message}`)))
                                        .pipe(outputStream, { end: true });
                        } catch (err) {
                                return fail(err);
                        }
                });
        }

        static stringifyEscaped(obj) {
                return JSON.stringify(obj).replace(/[\u007f-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
        }

        static buildBotHtml(html, title = 'HTML') {
                if (typeof html !== 'string' || !html.trim()) {
                        throw new TypeError('HTML payload must be a non-empty string');
                }

                if (typeof title !== 'string') {
                        throw new TypeError('Title must be a string');
                }

                const messageId = crypto.randomUUID();

                const responseData = {
                        response_id: messageId,

                        sections: [
                                {
                                        view_model: {
                                                primitive: {
                                                        __typename: 'GenAIaeacdsnwHtmlPrimitive',

                                                        payload: html,

                                                        trusted_sources: [],
                                                },

                                                __typename: 'GenAISingleLayoutViewModel',
                                        },
                                },
                        ],
                };

                return {
                        messageId,

                        content: {
                                messageContextInfo: {
                                        deviceListMetadata: {},
                                        deviceListMetadataVersion: 2,

                                        botMetadata: {
                                                messageDisclaimerText: '',
                                                botResponseId: messageId,
                                        },
                                },

                                botForwardedMessage: {
                                        message: {
                                                richResponseMessage: {
                                                        messageType: 1,

                                                        submessages: [
                                                                {
                                                                        messageType: 2,
                                                                        messageText: title,
                                                                },
                                                        ],

                                                        unifiedResponse: {
                                                                data: Buffer.from(JSON.stringify(responseData)).toString('base64'),
                                                        },

                                                        contextInfo: {
                                                                forwardingScore: 1,
                                                                isForwarded: true,

                                                                forwardedAiBotMessageInfo: {
                                                                        botJid: '867051314767696@bot',
                                                                },

                                                                forwardOrigin: 4,
                                                        },
                                                },
                                        },
                                },
                        },
                };
        }
}
