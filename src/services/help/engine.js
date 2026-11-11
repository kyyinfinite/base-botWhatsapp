import path from 'path'
import { metadata } from '../../core/plugin/registry.js'

const SECTION_MAP = {
    general: {
        id: 'menu',
        title: 'Menu & Navigasi',
        sub: 'Cara melihat dan memilih fitur',
        icon: 'menu'
    },
    game: {
        id: 'game',
        title: 'Game',
        sub: 'Permainan yang tersedia',
        icon: 'game'
    },
    snippet: {
        id: 'snippet',
        title: 'Snippet',
        sub: 'Menyimpan dan berbagi kode',
        icon: 'code'
    },
    owner: {
        id: 'owner',
        title: 'Owner & Premium',
        sub: 'Fitur dengan akses khusus',
        icon: 'user'
    },
    shell: {
        id: 'system',
        title: 'Sistem Internal',
        sub: 'Cara kerja bot di balik interface',
        icon: 'system'
    }
}

const STATIC_SECTIONS = [
    {
        id: 'menu',
        title: 'Menu & Navigasi',
        sub: 'Cara melihat dan memilih fitur',
        icon: 'menu',
        items: [
            ['Apa itu menu?', 'Menu adalah daftar fitur yang tersedia di bot. Jika kamu belum tahu command yang harus dipakai, mulai dari menu untuk melihat fitur dan kategori yang tersedia.'],
            ['Cara menggunakan', 'Kirim command menu pada chat. Dari daftar tersebut, pilih fitur yang ingin digunakan lalu ikuti petunjuk atau command yang ditampilkan oleh bot.'],
            ['Contoh', '', [['.menu', 'Menampilkan daftar fitur bot'], ['.help', 'Membuka pusat bantuan']]],
            ['Jika command tidak merespons', 'Pastikan prefix yang digunakan sesuai konfigurasi bot. Command juga harus ditulis lengkap dan dikirim sebagai pesan biasa.']]
    },
    {
        id: 'game', title: 'Game', sub: 'Permainan yang tersedia', icon: 'game', items: [
            ['Cara bermain', 'Game menggunakan command untuk membuka fitur. Beberapa game memiliki interface HTML interaktif, sedangkan lainnya menggunakan pesan atau tombol dari bot.'],
            ['Contoh command', '', [['.susunkata', 'Membuka permainan Susun Kata'], ['.asahotak', 'Memulai Asah Otak'], ['.tictactoe', 'Memulai Tic Tac Toe'], ['.catur', 'Membuka permainan catur']]]
        ]
    },
    {
        id: 'snippet', title: 'Snippet', sub: 'Menyimpan dan berbagi kode', icon: 'code', items: [
            ['Apa itu snippet?', 'Snippet digunakan untuk menyimpan potongan kode agar dapat dibagikan atau dicari kembali melalui bot.'],
            ['Mencari snippet', 'Gunakan fitur pencarian ketika kamu membutuhkan kode yang sudah tersimpan. Ikuti format input yang diminta bot.'],
            ['Snippet saya', 'Digunakan untuk melihat snippet yang berkaitan dengan akunmu.'],
            ['Contoh command', '', [['.carisnippet', 'Mencari snippet'], ['.getsnippet', 'Mengambil snippet'], ['.snippetsaya', 'Melihat snippet milik sendiri'], ['.kirimsnippet', 'Mengirim/menambahkan snippet'], ['.hapussnippet', 'Menghapus snippet']]]
        ]
    },
    {
        id: 'owner', title: 'Owner & Premium', sub: 'Fitur dengan akses khusus', icon: 'user', items: [
            ['Owner', 'Fitur owner digunakan untuk pengelolaan bot. Command dengan akses owner tidak dapat digunakan oleh pengguna biasa.'],
            ['Premium', 'Fitur premium hanya dapat digunakan oleh akun yang memiliki status premium atau akses yang sesuai.'],
            ['Mode bot', 'Bot dapat memiliki pembatasan berdasarkan mode operasi dan permission. Jika sebuah command ditolak, baca pesan akses yang diberikan bot.'],
            ['Contoh command owner', '', [['.addowner', 'Menambahkan owner'], ['.delowner', 'Menghapus owner'], ['.addprem', 'Menambahkan premium'], ['.delprem', 'Menghapus premium'], ['.public', 'Mengaktifkan mode public'], ['.self', 'Mengaktifkan mode self']]]
        ]
    },
    {
        id: 'system', title: 'Sistem Internal', sub: 'Cara kerja bot di balik interface', icon: 'system', items: [
            ['Plugin', 'Setiap fitur bot berada di dalam plugin. Engine membaca plugin dan menghubungkannya dengan command yang didaftarkan.'],
            ['Message Engine', 'Pesan yang masuk dinormalisasi terlebih dahulu agar berbagai tipe pesan dapat diproses dengan format yang konsisten.'],
            ['Permission', 'Sebelum plugin dijalankan, sistem dapat memeriksa owner, creator, premium, group, private, admin, bot admin, cooldown, dan limit.'],
            ['User & Group Database', 'Bot mencatat user dan group secara otomatis menggunakan penyimpanan JSON internal.'],
            ['Queue & eksekusi', 'Pesan dari chat yang sama diproses secara berurutan dan pesan duplikat dapat diabaikan. Error plugin diisolasi agar tidak langsung menjatuhkan seluruh bot.']
        ]
    },
    {
        id: 'trouble', title: 'Troubleshooting', sub: 'Jika bot tidak merespons', icon: 'info', items: [
            ['1. Cek prefix', 'Pastikan command diawali prefix yang benar, misalnya .menu. Prefix dapat berbeda sesuai konfigurasi bot.'],
            ['2. Cek penulisan', 'Gunakan nama command yang benar dan jangan menambahkan karakter yang tidak diperlukan.'],
            ['3. Cek permission', 'Beberapa fitur memang hanya untuk owner, premium, admin group, atau kondisi tertentu.'],
            ['4. Cek koneksi', 'Jika bot sedang offline, command tidak akan diproses sampai koneksi WhatsApp kembali aktif.'],
            ['5. Jika masih error', 'Periksa log terminal/server. Cari command terakhir yang digunakan dan file plugin terkait.']
        ]
    }
]

function clean(value) {
    return String(value ?? '').replace(/[<>]/g, '')
}

function folderOf(file) {
    const parts = String(file).split(path.sep)
    return parts.at(-2)?.toLowerCase() || 'general'
}

function permissionText(meta) {
    const permissions = []
    if (meta.owner) permissions.push('owner')
    if (meta.creator) permissions.push('creator')
    if (meta.premium) permissions.push('premium')
    if (meta.group) permissions.push('group')
    if (meta.private) permissions.push('private')
    if (meta.admin) permissions.push('admin')
    if (meta.botAdmin) permissions.push('bot admin')
    return permissions.length ? permissions.join(', ') : 'semua pengguna'
}

export function getHelpData(query = '') {
    const sections = structuredClone(STATIC_SECTIONS)
    const byId = new Map(sections.map(section => [section.id, section]))

    for (const [file, meta] of metadata.entries()) {
        const folder = folderOf(file)
        const sectionInfo = SECTION_MAP[folder] || SECTION_MAP.general
        const section = byId.get(sectionInfo.id)
        if (!section) continue

        const commands = Array.isArray(meta.commands) ? meta.commands.filter(Boolean).map(clean) : []
        if (!commands.length) continue

        const aliases = commands.map(command => `.${command}`).join(' / ')
        const description = clean(meta.description || '') || `Fitur dari plugin ${path.basename(file, '.js')}.`
        const access = permissionText(meta)

        let block = section.items.find(item => item[0] === 'Fitur terdaftar')
        if (!block) {
            block = ['Fitur terdaftar', 'Daftar berikut dibuat otomatis dari plugin yang sedang terdaftar di engine.', []]
            section.items.push(block)
        }

        block[2].push([aliases, `${description} · Akses: ${access}`])
    }

    for (const section of sections) {
        const featureBlock = section.items.find(item => item[0] === 'Fitur terdaftar')
        if (featureBlock?.[2]?.length) {
            featureBlock[2].sort((a, b) => a[0].localeCompare(b[0]))
        }
    }

    const normalized = clean(query).trim().toLowerCase().replace(/^\./, '')
    let selected = null

    if (normalized) {
        selected = sections.find(section => section.id === normalized || section.title.toLowerCase() === normalized)

        if (!selected) {
            selected = sections.find(section => section.items.some(item => {
                const commands = item[2] || []
                return commands.some(([command]) => command.split('/').some(alias => alias.trim().replace(/^\./, '') === normalized))
            }))
        }
    }

    return {
        version: 1,
        generatedAt: new Date().toISOString(),
        selected: selected?.id || null,
        sections
    }
}
