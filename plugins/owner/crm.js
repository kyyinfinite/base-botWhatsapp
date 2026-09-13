import { generateWAMessageFromContent } from '@whiskeysockets/baileys';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import path from 'path';

function unwrap(content) {
	if (!content || typeof content !== 'object') return content;

	if (content.ephemeralMessage?.message) return unwrap(content.ephemeralMessage.message);
	if (content.viewOnceMessage?.message) return unwrap(content.viewOnceMessage.message);
	if (content.viewOnceMessageV2?.message) return unwrap(content.viewOnceMessageV2.message);
	if (content.viewOnceMessageV2Extension?.message) return unwrap(content.viewOnceMessageV2Extension.message);
	if (content.documentWithCaptionMessage?.message) return unwrap(content.documentWithCaptionMessage.message);

	return content;
}

function normalizeForRelay(rawContent) {
	const content = unwrap(rawContent);

	if (typeof content?.conversation === 'string') {
		const { conversation, ...rest } = content;
		return { ...rest, extendedTextMessage: { text: conversation } };
	}

	return content;
}

function toJsLiteral(value, indent = 2, seen = new WeakSet(), depth = 0) {
	if (value === null) return 'null';
	if (value === undefined) return 'undefined';
	if (typeof value === 'string') return JSON.stringify(value);
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (typeof value === 'bigint') return value.toString();
	if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
		return JSON.stringify(Buffer.from(value).toString('base64'));
	}

	if (typeof value !== 'object') return JSON.stringify(value);

	if (depth > 40) return '"[MaxDepth]"';

	if (seen.has(value)) return '"[Circular]"';
	seen.add(value);

	const pad = ' '.repeat(indent);
	const padClose = ' '.repeat(Math.max(indent - 2, 0));

	let result;
	if (Array.isArray(value)) {
		if (!value.length) {
			result = '[]';
		} else {
			const items = value.map((v) => pad + toJsLiteral(v, indent + 2, seen, depth + 1));
			result = `[\n${items.join(',\n')}\n${padClose}]`;
		}
	} else {
		const keys = Object.keys(value).filter((k) => typeof value[k] !== 'function' && value[k] !== undefined);
		if (!keys.length) {
			result = '{}';
		} else {
			const lines = keys.map((k) => {
				const keyStr = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : JSON.stringify(k);
				return `${pad}${keyStr}: ${toJsLiteral(value[k], indent + 2, seen, depth + 1)}`;
			});
			result = `{\n${lines.join(',\n')}\n${padClose}}`;
		}
	}

	seen.delete(value);
	return result;
}

const FRAMEWORK_DECORATED_KEYS = new Set([
	'mtype', 'id', 'chat', 'isBaileys', 'sender', 'fromMe', 'mentionedJid',
	'fakeObj', 'delete', 'copyNForward', 'download', 'key', 'participant',
	'text', 'body', 'name', 'pushName', 'viewonce', 'download1',
]);

function stripFrameworkProps(content) {
	if (!content || typeof content !== 'object') return content;
	const out = {};
	for (const k of Object.keys(content)) {
		if (FRAMEWORK_DECORATED_KEYS.has(k)) continue;
		if (typeof content[k] === 'function') continue;
		out[k] = content[k];
	}
	return out;
}

function buildReadableSendCode(content) {
	try {
		const clean = stripFrameworkProps(content);
		return `=> conn.relayMessage(\n  m.chat,\n  ${toJsLiteral(clean)},\n  {}\n)`;
	} catch (err) {
		return `// Gagal generate relay_code: ${err?.message || err}`;
	}
}

function typeNameFromContent(content) {
	const clean = stripFrameworkProps(content);
	const key = Object.keys(clean)[0] || 'UnknownMessage';
	return key.charAt(0).toUpperCase() + key.slice(1);
}

function buildRelayCodeFile(rawQuotedContent) {
	const dir = path.join(process.cwd(), 'debug');
	mkdirSync(dir, { recursive: true });

	const typeName = typeNameFromContent(rawQuotedContent);
	const filename = `${typeName}.js`;
	const filepath = path.join(dir, filename);

	const code = buildReadableSendCode(rawQuotedContent);
	writeFileSync(filepath, code, 'utf-8');

	return { filepath, filename };
}


const makeCodeBlocks = (code) => {
	const blocks = [];

	const regex = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|\b(?:const|let|var|function|return|class|static|new|async|await|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|import|export|from|default|extends|typeof|instanceof|in|of|delete|void|yield)\b|\b(?:true|false|null|undefined)\b|\b\d+(?:\.\d+)?\b)/g;

	let lastIndex = 0;
	let match;

	while ((match = regex.exec(code)) !== null) {
		if (match.index > lastIndex) {
			blocks.push({
				highlightType: 0,
				codeContent: code.slice(lastIndex, match.index),
			});
		}

		const token = match[0];
		let highlightType = 0;

		if (/^(const|let|var|function|return|class|static|new|async|await|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|import|export|from|default|extends|typeof|instanceof|in|of|delete|void|yield)$/.test(token)) {
			highlightType = 1;
		} else if (/^(true|false|null|undefined)$/.test(token)) {
			highlightType = 2;
		} else if (/^\d/.test(token)) {
			highlightType = 2;
		} else if (/^['"`]/.test(token)) {
			highlightType = 3;
		} else if (/^\/\//.test(token) || /^\/\*/.test(token)) {
			highlightType = 4;
		}

		blocks.push({
			highlightType,
			codeContent: token,
		});

		lastIndex = regex.lastIndex;
	}

	if (lastIndex < code.length) {
		blocks.push({
			highlightType: 0,
			codeContent: code.slice(lastIndex),
		});
	}

	return blocks;
};

async function sendSnippet(conn, m, rawQuoted) {
	const code = buildReadableSendCode(rawQuoted);

	await conn.relayMessage(
  m.chat,
  {
    messageContextInfo: {
      deviceListMetadata: {},
      deviceListMetadataVersion: 2,
      botMetadata: {
        messageDisclaimerText: "",
        botResponseId: "58fdc76c-f202-47a9-90d2-b089eac0ad2c",
        verificationMetadata: {
          proofs: [
            {
              version: 1,
              useCase: 1,
              signature: "TklYRUwuTWVzc2FnZUJ1aWxkZXJWNC43LVZlcmlmaWNhdGlvblNpZ25hdHVyZS5NZXRhZGF0YVhh6xH/dtA3Ag==",
              certificateChain: [
                "TklYRUwuTWVzc2FnZUJ1aWxkZXJWNC43LUNlcnRpZmljYXRlQ2hhaW4uTWV0YWRhdGH//zGpMImJh+iCc4A8KygG7r/xPdBGhrA6N0AvS8W5lck74PnLbHPY1k0Wc4ftBCswft7oHCfrCRKVgQBravQ2eyGrcksQUcrVwcp1DcsICX38+a323RnkJkl2J4qG1C2rGc+jg939PmKLhOOJG8cTh+0z1MpDXRiYj//NgkU0GBo3kv5hXXOZX33g1eQUZ9hTxlzWOOh7BRAIBHFHZIr0hohDvnpfgMADM1li3XIXFYlthNQUavirx/qUKx5iuJChV6LihLTfiVEVu3xABWDnuCGXhNaYBzYJZ1ia8T9ar5BHBT4EFCxuDj+qON7mV7bSJ6weZhmFX8FuKiCjeW4gJds24dPrdFBShOilZrcgJCMFdnctpQ1gSePHzQGIBCCPRzvxFhQksUmoPhg8bo9XU43+s5aCT/y38Swx1WWQjYORVnf8KPaBaohk6AAtoLxclC25nnRrdIdxza1Fi9fNG06OyZKf7F42k0pKH/mU9pzHkBUMIQ43xaFLY634VdJMCPmoTFgwDnuhRgTDS+aI7vtbOsPtCIkhR6R9E4u2wI9gd0bM4krsRKqEU8Jc/KD/4pfCEzuzTXOgJYWO+4hUebAg7XWr2F+LQYkOLG+OEhrEgq1GCsXcp9jH4V7NDoPMuBUH9MVk5CCvWnPtdw9rQKg8eRqeTNQtZIGYCKUzrehLEfE9Zz4UwVspnlnct4shtbHowNDMlBK4hq+/4Vt8GofGmkNFkOnZMD++1O4Ay1AmTlIZZPCSJxT4OLfTBhxPfREyFf7oRcChQo9aXiBKSUjo5UkD9lUojFxfpVZ+bl2CH8RV9b483Byk25vTqG1kg9GETqX/V5K1",
                "TklYRUwuTWVzc2FnZUJ1aWxkZXJWNC43LUNlcnRpZmljYXRlQ2hhaW4uTWV0YWRhdGFB+1trZnswR8m/c3Wcd0nxfYuZIyqLuWFIOOSUGu2/C7qVLRzuYaMM83KrQa+QipOAauPXOZr9WpCw6N3mB3FX/C6KcYu7flpq4S116PpzDDN5BNgPhmQVqMJ6skTr/vBknVfuznE2FVc0oJYASwjJEpC3K1UP5GqZbq7xxzmPCuQUlM4kpSpiGKEdG8cZOrDVXDW22ZZ3eZfWzZBxkhW8sZvn7Pv6FVaPwVPPWQfETOKH68iPGgzY21wY7fZ4JNJfBCsXrx8HgBiZ+C4/m0eU7OQoM0TkO3++L4Y5CGj+R8zRHkv1cnU1H2aeGqlglLH6ceAasnPDtc3gvNyVJF+lSh6V7cX2MkhdXakrK7SPigS5HITqDi5W6c9OwVUsJ4eAug8iyOgjD0qmoXZWijBIg7daBdOAew0akxDKm8F6U9N38I8SuvHrre6iiBK7+06ngtWB5d4phwc/xWhpdHsmwUQOakr8XRTocdDL/oQTUoDII5sFD3Wv+yrazeUtyx7Sq+28yKRL+FtjpPFibF8AuDW6HeyjORNdiirnJztVD8fFXs/d96GlMIvgiFYsCxGCUlQv998bYfwZ85s/PE00JwE3j2w7wRN9T+vgnGVfISy6I+0Wf5nw3ey1jkp+90kT26ZtaRRVY73/Q0A7kNebSs1bmRHwdiDHK33Z2ng7o/U7HwKdh1xnjEcYS1QwkWFprdQI0Ic70uRzfungu+KIKB7SGb/VEsESLhaxF0XP0zjn5clvRMxKGPPmuYjj0ojGqx20KJKLer3lW63qVJsNVWCkr9lpxX7vJXIjrDh1crcu1TMNipUCrmjhnm0yuG6TZtvrrCR7n3XQcxSqsQ8ZhiW5yb1SFpcQdanal2Ai0dBdxoJ7mBrPCUyjBG0j2MyfpgWD8GSk/xHVphEJYONnPGcFNIv0KsYWazBSLbgz+UNNcM45m9dofgWhg5YUrOLE/eQ076UsX1L7CH+AzbzKWsk/j4aabS0n9XNQxX3Kq89Gj1WJ8YtV6m48vHsNZZUjG/YkoTN12Gu9RUyhbBpoHM0vTTXjX9/7+uh/mn11wIGXRyTumbO7YVNtQtHgUl4UtuI2Uq1COxzZURvjeukO4a4kIBz9hmzRQ=="
              ]
            }
          ]
        }
      }
    },
    botForwardedMessage: {
      message: {
        richResponseMessage: {
          submessages: [
            {
              messageType: 2,
              messageText: `Convert relay message 🔥🔥.`
            },
            {
              messageType: 5,
              codeMetadata: {
                codeLanguage: "javascript",
                codeBlocks: makeCodeBlocks(code)
              }
            }
          ],
          contextInfo: {
            forwardingScore: 1,
            isForwarded: true,
            forwardedAiBotMessageInfo: {
              botJid: "0@bot"
            },
            forwardOrigin: 4
          }
        }
      }
    }
  },
  {}
)
}

let handler = async (m, { conn, args, usedPrefix, command }) => {
	const rawQuoted = m.quoted?.message || m.msg?.contextInfo?.quotedMessage;

	if (!rawQuoted) {
		await conn.sendMessage(
			m.chat,
			{ text: `❌ Reply pesan yang mau di-relay dulu, lalu ketik *${usedPrefix + command}*` },
			{ quoted: m }
		);
		return;
	}

	const unwrapped = unwrap(rawQuoted);

	if (!unwrapped || typeof unwrapped !== 'object' || !Object.keys(unwrapped).length) {
		await conn.sendMessage(m.chat, { text: '❌ Jenis pesan ini belum didukung untuk di-relay.' }, { quoted: m });
		return;
	}

	const relayContent = normalizeForRelay(rawQuoted);

	const relayMsg = generateWAMessageFromContent(m.chat, relayContent, {
		userJid: conn.user.id,
		quoted: m,
	});

	await conn.relayMessage(relayMsg.key.remoteJid, relayMsg.message, {
		messageId: relayMsg.key.id,
	});

	const isSnippet = (args?.[0] || '').toLowerCase() === '-snipp' || /snipp/i.test(command);

	if (isSnippet) {
		try {
			await sendSnippet(conn, m, unwrapped);
		} catch (err) {
			await conn.sendMessage(
				m.chat,
				{ text: `⚠️ Gagal kirim snippet: ${err?.message || err}` },
				{ quoted: m }
			);
		}
		return;
	}

	const { filepath, filename } = buildRelayCodeFile(unwrapped);

	await conn.sendMessage(
		m.chat,
		{
			document: readFileSync(filepath),
			fileName: filename,
			mimetype: 'text/javascript',
			caption: `📄 ${filename}`,
		},
		{ quoted: m }
	);
};

handler.command = ['crm', 'crmsnipp'];
handler.help = ['crm (reply pesan)', 'crm -snipp (reply pesan)'];
handler.tags = ['tools'];
handler.owner = true;

export default handler;