export function extractIE(text, { extract = true, hyperlink = true, citation = true, latex = true } = {}) {
	if (!extract) {
		return {
			text,
			ie: [],
			inline_entities: [],
		};
	}

	const createIE = (type, ie) => {
		if (type == 'hyperlink') {
			return {
				key: ie.key,
				metadata: {
					display_name: ie.text,
					is_trusted: ie.is_trusted,
					url: ie.url,
					__typename: 'GenAIInlineLinkItem',
				},
			};
		}

		if (type == 'citation') {
			return {
				key: ie.key,
				metadata: {
					reference_id: ie.reference_id,
					reference_url: ie.url,
					reference_title: ie.url,
					reference_display_name: ie.url,
					sources: [],
					__typename: 'GenAISearchCitationItem',
				},
			};
		}

		if (type == 'latex') {
			return {
				key: ie.key,
				metadata: {
					latex_expression: ie.text,
					latex_image: {
						url: ie.url,
						width: Number(ie.width) || 100,
						height: Number(ie.height) || 100,
					},
					font_height: Number(ie.font_height) || 83.333333333333,
					padding: Number(ie.padding) || 15,
					__typename: 'GenAILatexItem',
				},
			};
		}
	};

	let ie = [];
	let inline_entities = [];
	let result = '';
	let last = 0;
	let citation_index = 1;
	let hyperlink_index = 0;
	let latex_index = 0;
	let stack = [];

	for (let i = 0; i < text.length; i++) {
		if (text[i] == '[' && text[i - 1] != '\\') {
			stack.push(i);
		} else if (text[i] == ']' && (text[i + 1] == '(' || text[i + 1] == '<')) {
			let start = stack.pop();

			if (start == null) continue;

			let open = text[i + 1];
			let close = open == '(' ? ')' : '>';
			let type = open == '(' ? 'link' : 'latex';
			let end = i + 2;
			let depth = 1;

			while (end < text.length && depth) {
				if (text[end] == open && text[end - 1] != '\\') depth++;
				else if (text[end] == close && text[end - 1] != '\\') depth--;
				end++;
			}

			if (depth) continue;

			let raw = text.slice(start + 1, i).trim();
			let url = text.slice(i + 2, end - 1).trim();

			let key;
			let tag;
			let data;

			if (type == 'latex') {
				if (!latex) continue;

				let [txt = '', width = null, height = null, font_height = null, padding = null] = raw.split('|');

				key = `\u004E\u0049\u0058\u0045\u004C_LATEX_${latex_index++}`;
				tag = `{{${key}}}${txt || 'image'}{{/${key}}}`;

				data = {
					type: 'latex',
					ie: {
						key,
						text: txt,
						url,
						width,
						height,
						font_height,
						padding,
					},
				};
			} else if (raw) {
				if (!hyperlink) continue;

				const trusted = !url.startsWith('!');

				if (!trusted) {
					url = url.slice(1);
				}

				key = `\u004E\u0049\u0058\u0045\u004C_HYPERLINK_${hyperlink_index++}`;
				tag = `{{${key}}}${url}{{/${key}}}`;

				data = {
					type: 'hyperlink',
					ie: {
						key,
						text: raw,
						url,
						is_trusted: trusted,
					},
				};
			} else {
				if (!citation) continue;

				key = `\u004E\u0049\u0058\u0045\u004C_CITATION_${citation_index - 1}`;
				tag = `{{${key}}}${url}{{/${key}}}`;

				data = {
					type: 'citation',
					ie: {
						reference_id: citation_index++,
						key,
						text: '',
						url,
					},
				};
			}

			result += text.slice(last, start) + tag;
			last = end;

			ie.push(data);

			const entity = createIE(data.type, data.ie);

			if (entity) {
				inline_entities.push(entity);
			}

			i = end - 1;
		}
	}

	result += text.slice(last);

	return {
		text: result,
		ie,
		inline_entities,
	};
}

export async function waitAllPromises(input) {
	const isPromise = (v) => v && typeof v.then === 'function';
	const isObject = (v) => v && typeof v === 'object';

	const deep = async (v) => {
		if (isPromise(v)) return deep(await v);
		if (Array.isArray(v)) return Promise.all(v.map(deep));
		if (isObject(v)) {
			const entries = await Promise.all(Object.entries(v).map(async ([k, val]) => [k, await deep(val)]));
			return Object.fromEntries(entries);
		}
		return v;
	};

	return deep(await input);
}
