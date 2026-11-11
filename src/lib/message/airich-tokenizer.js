export function tokenizeCode(code, lang = 'javascript') {
const keywordsMap = {
        javascript: new Set([
                'break',
                'case',
                'catch',
                'continue',
                'debugger',
                'delete',
                'do',
                'else',
                'finally',
                'for',
                'function',
                'if',
                'in',
                'instanceof',
                'new',
                'return',
                'switch',
                'this',
                'throw',
                'try',
                'typeof',
                'var',
                'void',
                'while',
                'with',
                'true',
                'false',
                'null',
                'undefined',
                'class',
                'const',
                'let',
                'super',
                'extends',
                'export',
                'import',
                'yield',
                'static',
                'constructor',
                'async',
                'await',
                'get',
                'set',
        ]),

        typescript: new Set([
                'abstract',
                'any',
                'as',
                'asserts',
                'bigint',
                'boolean',
                'declare',
                'enum',
                'implements',
                'infer',
                'interface',
                'is',
                'keyof',
                'module',
                'namespace',
                'never',
                'readonly',
                'require',
                'number',
                'object',
                'override',
                'private',
                'protected',
                'public',
                'satisfies',
                'string',
                'symbol',
                'type',
                'unknown',
                'using',
                'from',
                'break',
                'case',
                'catch',
                'continue',
                'do',
                'else',
                'finally',
                'for',
                'function',
                'if',
                'new',
                'return',
                'switch',
                'this',
                'throw',
                'try',
                'var',
                'void',
                'while',
                'class',
                'const',
                'let',
                'extends',
                'import',
                'export',
                'async',
                'await',
        ]),

        python: new Set([
                'False',
                'None',
                'True',
                'and',
                'as',
                'assert',
                'async',
                'await',
                'break',
                'class',
                'continue',
                'def',
                'del',
                'elif',
                'else',
                'except',
                'finally',
                'for',
                'from',
                'global',
                'if',
                'import',
                'in',
                'is',
                'lambda',
                'nonlocal',
                'not',
                'or',
                'pass',
                'raise',
                'return',
                'try',
                'while',
                'with',
                'yield',
        ]),

        java: new Set([
                'abstract',
                'assert',
                'boolean',
                'break',
                'byte',
                'case',
                'catch',
                'char',
                'class',
                'const',
                'continue',
                'default',
                'do',
                'double',
                'else',
                'enum',
                'extends',
                'final',
                'finally',
                'float',
                'for',
                'goto',
                'if',
                'implements',
                'import',
                'instanceof',
                'int',
                'interface',
                'long',
                'native',
                'new',
                'package',
                'private',
                'protected',
                'public',
                'return',
                'short',
                'static',
                'strictfp',
                'super',
                'switch',
                'synchronized',
                'this',
                'throw',
                'throws',
                'transient',
                'try',
                'void',
                'volatile',
                'while',
        ]),

        golang: new Set([
                'break',
                'case',
                'chan',
                'const',
                'continue',
                'default',
                'defer',
                'else',
                'fallthrough',
                'for',
                'func',
                'go',
                'goto',
                'if',
                'import',
                'interface',
                'map',
                'package',
                'range',
                'return',
                'select',
                'struct',
                'switch',
                'type',
                'var',
        ]),

        c: new Set([
                'auto',
                'break',
                'case',
                'char',
                'const',
                'continue',
                'default',
                'do',
                'double',
                'else',
                'enum',
                'extern',
                'float',
                'for',
                'goto',
                'if',
                'int',
                'long',
                'register',
                'return',
                'short',
                'signed',
                'sizeof',
                'static',
                'struct',
                'switch',
                'typedef',
                'union',
                'unsigned',
                'void',
                'volatile',
                'while',
        ]),

        cpp: new Set([
                'alignas',
                'alignof',
                'and',
                'auto',
                'bool',
                'break',
                'case',
                'catch',
                'class',
                'const',
                'constexpr',
                'continue',
                'delete',
                'do',
                'double',
                'else',
                'enum',
                'explicit',
                'export',
                'extern',
                'false',
                'float',
                'for',
                'friend',
                'if',
                'inline',
                'int',
                'long',
                'mutable',
                'namespace',
                'new',
                'noexcept',
                'nullptr',
                'operator',
                'private',
                'protected',
                'public',
                'return',
                'short',
                'signed',
                'sizeof',
                'static',
                'struct',
                'switch',
                'template',
                'this',
                'throw',
                'true',
                'try',
                'typedef',
                'typename',
                'union',
                'unsigned',
                'using',
                'virtual',
                'void',
                'while',
        ]),

        php: new Set([
                'abstract',
                'and',
                'array',
                'as',
                'break',
                'callable',
                'case',
                'catch',
                'class',
                'clone',
                'const',
                'continue',
                'declare',
                'default',
                'do',
                'echo',
                'else',
                'elseif',
                'empty',
                'enddeclare',
                'endfor',
                'endforeach',
                'endif',
                'endswitch',
                'endwhile',
                'extends',
                'final',
                'finally',
                'fn',
                'for',
                'foreach',
                'function',
                'global',
                'goto',
                'if',
                'implements',
                'include',
                'include_once',
                'instanceof',
                'interface',
                'match',
                'namespace',
                'new',
                'null',
                'or',
                'private',
                'protected',
                'public',
                'require',
                'require_once',
                'return',
                'static',
                'switch',
                'throw',
                'trait',
                'try',
                'use',
                'var',
                'while',
                'yield',
        ]),

        rust: new Set([
                'as',
                'break',
                'const',
                'continue',
                'crate',
                'else',
                'enum',
                'extern',
                'false',
                'fn',
                'for',
                'if',
                'impl',
                'in',
                'let',
                'loop',
                'match',
                'mod',
                'move',
                'mut',
                'pub',
                'ref',
                'return',
                'self',
                'Self',
                'static',
                'struct',
                'super',
                'trait',
                'true',
                'type',
                'unsafe',
                'use',
                'where',
                'while',
        ]),

        html: new Set([
                'html',
                'head',
                'body',
                'div',
                'span',
                'p',
                'a',
                'img',
                'video',
                'audio',
                'script',
                'style',
                'link',
                'meta',
                'form',
                'input',
                'button',
                'table',
                'tr',
                'td',
                'th',
                'ul',
                'ol',
                'li',
                'section',
                'article',
                'header',
                'footer',
                'nav',
                'main',
        ]),

        bash: new Set([
                'if',
                'then',
                'else',
                'elif',
                'fi',
                'for',
                'while',
                'do',
                'done',
                'case',
                'esac',
                'function',
                'in',
                'select',
                'until',
                'break',
                'continue',
                'return',
                'export',
                'readonly',
                'local',
                'declare',
        ]),

        markdown: new Set(['#', '##', '###', '####', '#####', '######']),
};

if (!lang || lang === 'txt' || lang === 'text' || lang === 'plaintext') {
        return {
                codeBlock: [
                        {
                                codeContent: code,
                                highlightType: 0,
                        },
                ],
                unified_codeBlock: [
                        {
                                content: code,
                                type: 'DEFAULT',
                        },
                ],
        };
}

const TYPE_MAP = {
        0: 'DEFAULT',
        1: 'KEYWORD',
        2: 'METHOD',
        3: 'STR',
        4: 'NUMBER',
        5: 'COMMENT',
};

const keywords = keywordsMap[lang.toLowerCase()] || new Set();
const tokens = [];

let i = 0;

const push = (content, type) => {
        if (!content) return;

        const last = tokens[tokens.length - 1];

        if (last && last.highlightType === type) {
                last.codeContent += content;
        } else {
                tokens.push({
                        codeContent: content,
                        highlightType: type,
                });
        }
};

const isIdentifier = (char) => {
        switch (lang.toLowerCase()) {
                case 'css':
                        return /[a-zA-Z0-9_$-]/.test(char);

                case 'html':
                        return /[a-zA-Z0-9_$:-]/.test(char);

                default:
                        return /[a-zA-Z0-9_$]/.test(char);
        }
};

while (i < code.length) {
        const c = code[i];

        if (/\s/.test(c)) {
                let s = i;

                while (i < code.length && /\s/.test(code[i])) {
                        i++;
                }

                push(code.slice(s, i), 0);
                continue;
        }

        if ((c === '/' && code[i + 1] === '/') || (c === '#' && ['python', 'bash'].includes(lang))) {
                let s = i;

                while (i < code.length && code[i] !== '\n') {
                        i++;
                }

                push(code.slice(s, i), 5);
                continue;
        }

        if (c === '"' || c === "'" || c === '`') {
                let s = i;
                const q = c;

                i++;

                while (i < code.length) {
                        if (code[i] === '\\' && i + 1 < code.length) {
                                i += 2;
                        } else if (code[i] === q) {
                                i++;
                                break;
                        } else {
                                i++;
                        }
                }

                push(code.slice(s, i), 3);
                continue;
        }

        if (/[0-9]/.test(c)) {
                let s = i;

                while (i < code.length && /[0-9._]/.test(code[i])) {
                        i++;
                }

                push(code.slice(s, i), 4);
                continue;
        }

        if (/[a-zA-Z_$]/.test(c)) {
                let s = i;

                while (i < code.length && isIdentifier(code[i])) {
                        i++;
                }

                const word = code.slice(s, i);

                let type = 0;

                if (keywords.has(word)) {
                        type = 1;
                } else if (lang === 'css') {
                        let j = i;

                        while (j < code.length && /\s/.test(code[j])) {
                                j++;
                        }

                        if (code[j] === ':') {
                                type = 1;
                        }
                } else if (lang === 'html') {
                        let p = s - 1;

                        while (p >= 0 && /\s/.test(code[p])) {
                                p--;
                        }

                        if (code[p] === '<' || (code[p] === '/' && code[p - 1] === '<')) {
                                type = 1;
                        }
                }

                if (type === 0) {
                        let j = i;

                        while (j < code.length && /\s/.test(code[j])) {
                                j++;
                        }

                        if (code[j] === '(') {
                                type = 2;
                        }
                }

                push(word, type);
                continue;
        }

        push(c, 0);
        i++;
}

return {
        codeBlock: tokens,
        unified_codeBlock: tokens.map((t) => ({
                content: t.codeContent,
                type: TYPE_MAP[t.highlightType],
        })),
};

}
