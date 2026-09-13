import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { KyyInfinite } from '@kyyinfinite/sdk'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const configPath = path.join(__dirname, '../../../config.json')

const ALLOWED_LANGUAGES = ['javascript', 'typescript', 'python', 'bash', 'json']
const MAX_TITLE_LENGTH = 120
const MAX_CODE_LENGTH = 300000

let client = null
let cachedApiKey = null

const getConfig = () => JSON.parse(fs.readFileSync(configPath, 'utf8'))

const getClient = () => {
    const config = getConfig()
    const apikey = config.kyyinfinite?.apikey

    if (!apikey || apikey === 'kyy_xxxxxxx') {
        throw new Error('API key kyyinfinite belum diatur di config.json')
    }

    if (!client || cachedApiKey !== apikey) {
        client = new KyyInfinite({
            baseUrl: config.kyyinfinite?.baseUrl,
            apiKey: apikey
        })
        cachedApiKey = apikey
    }

    return client
}

export const browse = async ({ search, language } = {}) =>
    getClient().snippets.list({ search, language })

export const getById = async (id) =>
    getClient().snippets.get(id)

export const getRaw = async (id) =>
    getClient().snippets.getRaw(id)

export const submit = async ({ title, description, language, code, tags = [], forkedFrom }) => {
    if (!title || !title.trim()) throw new Error('Judul snippet wajib diisi')
    if (title.trim().length > MAX_TITLE_LENGTH) throw new Error(`Judul maksimal ${MAX_TITLE_LENGTH} karakter`)
    if (!description || !description.trim()) throw new Error('Deskripsi snippet wajib diisi')
    if (!ALLOWED_LANGUAGES.includes(language)) throw new Error(`Bahasa harus salah satu dari: ${ALLOWED_LANGUAGES.join(', ')}`)
    if (!code || !code.trim()) throw new Error('Kode snippet wajib diisi')
    if (code.length > MAX_CODE_LENGTH) throw new Error(`Kode maksimal ${MAX_CODE_LENGTH} karakter`)

    return getClient().snippets.submit({
        title: title.trim(),
        description: description.trim(),
        language,
        code,
        tags,
        forkedFrom
    })
}

export const listMine = async () =>
    getClient().snippets.listMine()

export const remove = async (id) =>
    getClient().snippets.withdraw(id)

export { ALLOWED_LANGUAGES }
