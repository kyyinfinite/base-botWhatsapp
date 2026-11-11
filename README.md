# base-wa-esm

Framework WhatsApp bot modular berbasis [Baileys](https://github.com/WhiskeySockets/Baileys) dengan JavaScript ESM. Arsitekturnya sederhana: engine menangani koneksi, dispatcher, middleware, dan database — developer cukup menulis plugin.

## Persyaratan

- Node.js >= 20

## Instalasi

```bash
npm install
```

## Menjalankan

```bash
npm start
```

Saat pertama kali dijalankan, bot meminta nomor WhatsApp untuk pairing code. Setelah terhubung, kirim `.menu` untuk melihat daftar fitur.

Perintah lain:

```bash
npm test    # menjalankan test suite (node --test)
npm check   # cek sintaks index.js
```

## Konfigurasi (config.json)

| Field | Keterangan |
| --- | --- |
| `botName` | Nama bot, dipakai menu |
| `ownerName` | Nama owner |
| `creator` | Array nomor creator (akses tertinggi) |
| `prefix` | Array prefix perintah, misal `[".", "#"]` |
| `botMode` | `public` (semua user) atau `self` (hanya owner) |
| `dailyLimit` | Limit harian per user untuk plugin berlimit |
| `usePairingCode` | `true` = login pairing code, `false` = login QR (string QR dicetak ke terminal) |
| `accessDenied` | Pesan penolakan akses per tipe |
| `kyyinfinite` | API key untuk fitur snippet |

Owner dan premium disimpan di `src/database/owner.json` dan `src/database/premium.json` (array nomor). Kelolanya lewat perintah `.addowner`, `.delowner`, `.addprem`, `.delprem`.

## Menulis Plugin

Semua fitur adalah plugin di folder `plugins/`. Buat file `.js` baru, langsung terdeteksi tanpa restart (hot reload).

```js
import { Button } from '../../src/lib/message/wrapper.js'

let handler = async (m, { conn }) => {
    await new Button(conn)
        .setBody('Hello')
        .setFooter('WhatsApp Bot')
        .addUrl('Website', 'https://example.com')
        .send(m.chat)
}

handler.command = ['example']
export default handler
```

Aturan penulisan:

- Deklarasi memakai `let handler`, bukan `const handler`.
- Signature: `async (m, { conn, args, text, command, prefix, notifReply, accessDenied, context })`.
- Daftarkan perintah dengan `handler.command` (string atau array). Command otomatis lowercase.
- Tutup dengan `export default handler`.

### Metadata plugin

| Metadata | Efek |
| --- | --- |
| `handler.command` | Nama perintah, string atau array |
| `handler.customPrefix` | RegExp untuk pesan khusus, misal `/^=>/` untuk eval |
| `handler.owner` / `handler.creator` | Hanya owner / creator |
| `handler.premium` | Hanya user premium (owner juga bisa) |
| `handler.group` / `handler.private` | Hanya di grup / hanya di chat pribadi |
| `handler.admin` / `handler.botAdmin` | Butuh admin grup / bot harus admin |
| `handler.cooldown` | Jeda antar pemakaian per user (detik) |
| `handler.limit` | Biaya limit (`true` = 1, atau angka) |
| `handler.help` / `handler.tags` / `handler.description` | Ditampilkan di menu dan help |

Urutan pemeriksaan middleware: owner → creator → premium → group → private → admin → botAdmin → cooldown → limit. Middleware yang error bersifat fail-closed (perintah ditolak).

Plugin dengan `handler.command` yang sama akan ditolak (owner pertama dipertahankan). Plugin yang gagal dimuat atau gagal validasi saat hot reload tidak akan menghapus versi lama yang masih berjalan.

### Objek `m`

`m` adalah pesan yang sudah dinormalisasi: `m.text`, `m.chat`, `m.sender`, `m.userJid`, `m.isGroup`, `m.fromMe`, `m.isOwner`, `m.isCreator`, `m.isPremium`, `m.quoted`, `m.reply()`, `m.userRecord`, `m.groupRecord`. Respon tombol hadir sebagai `m.isButtonResponse` dan diproses lewat alur command yang sama.

### Identitas LID dan PN

WhatsApp modern memakai dua bentuk identitas personal: nomor telepon (`628xxx@s.whatsapp.net`, disebut PN) dan LID (`123456789012345@lid`). Framework menangani keduanya secara otomatis:

- Setiap pesan masuk memicu auto-capture pasangan LID↔PN dari `remoteJidAlt`, `participantAlt`, field kontak, dan metadata grup, lalu disimpan lewat API resmi Baileys (`signalRepository.lidMapping`) plus cache lokal yang dipersist ke `src/database/identity.json`.
- Plugin tetap memakai `m.sender` (bentuk JID asli pesan). Properti tambahan tersedia tanpa merusak yang lama: `m.senderPn`, `m.senderLid`, `m.identityNumber` (nomor PN bila diketahui), `m.identityJids` (semua JID user), `m.identityKey`.
- Owner/premium/limit/cooldown dicocokkan terhadap seluruh identitas — user yang kirim via LID tetap dikenali sebagai owner yang didaftarkan lewat nomor PN.
- Jika mapping belum tersedia, pesan LID tetap diproses dengan LID sebagai identitas valid (tidak ada nomor telepon palsu). Setelah mapping diketahui, record user otomatis konvergen ke PN.
- JID grup, broadcast, dan newsletter tidak pernah diperlakukan sebagai identitas user.

## Message Wrapper

Import dari `src/lib/message/wrapper.js`. Semua builder memakai chain method dengan pola `set...()`, `add...()`, `clear...()`, `build()`, `send()`.

- **Button** — interactive message native flow: `setBody`, `setFooter`, `setImage`, `addUrl`, `addReply`, `addCopy`, `addSelection`, `makeSection`, `makeRow`, `clearButtons`.
- **ButtonV2** — buttonsMessage klasik: `setTitle`, `setSubtitle`, `setBody`, `setFooter`, `setThumbnail`, `addButton`, `addRawButton`, `setRawThumbnail`.
- **Carousel** — kartu bergulir: `setBody`, `setFooter`, `addCard` (kartu wajib punya header media).
- **AIRich** — pesan AI rich response: `addText`, `addCode`, `addTable`, `addImage`, `addVideo`, `addHtml`, `addSource`, `addSuggest`, `sendEdit`.
- **Foad / Foad2** — FOAD embedded widget dan fullscreen: `addTitle`, `setPreviewTitle`, `addHtml`, `addTab`, `clearTabs`.
- **Toolkit** — utilitas statis: `resize`, `fetchBuffer`, `resolveMedia`, `getMp4Duration`, `getMp4Preview`, `extractIE`, `stringifyEscaped`, `buildBotHtml` (payload HTML siap `conn.relayMessage`).

Contoh kirim HTML sederhana:

```js
import { Toolkit } from '../../src/lib/message/wrapper.js'

const html = fs.readFileSync(htmlPath, 'utf8')
const { content, messageId } = Toolkit.buildBotHtml(html, 'Judul')
await conn.relayMessage(m.chat, content, { messageId })
```

## Struktur Proyek

```
index.js                       entry point: scheduler, koneksi, graceful shutdown
config.json                    konfigurasi bot
plugins/                       plugin bot (per kategori folder)
src/core/
  app/connect.js               koneksi Baileys, pairing, lifecycle reconnect, simpan kredensial, event cleanup
  app/reconnect.js             helper murni klasifikasi status (515/401/440/...), backoff & keputusan reconnect
  dispatcher/dispatcher.js     pipeline pesan: identitas → mode → antrian → eksekusi
  dispatcher/parse.js          parsing command, button response, custom prefix
  plugin/registry.js           penyimpanan plugin, validasi kontrak, ownership, rollback
  plugin/loader.js             load, hot reload, file watcher
  middleware/engine.js         rantai middleware + registrasi kustom
  middleware/*.js              middleware bawaan per aturan akses
  context/createContext.js     context yang diterima plugin
  message/normalize.js         ekstraksi teks dari semua tipe pesan
  queue/engine.js              antrian per chat (urut, error terisolasi)
  queue/dedupe.js              filter pesan duplikat
  scheduler/limitReset.js      reset limit harian
  errors/engine.js             pelaporan error terpusat
  events/engine.js             event bus internal
src/lib/message/               message wrapper (wrapper.js = pintu masuk publik)
src/services/
  config.js                    cache config.json + update atomik
  access.js                    daftar owner & premium
  identity-resolver.js         resolver LID ↔ PN (auto-capture + store Baileys + cache lokal)
  database/                    JSON database (user, group, settings, identity mapping)
  menu-engine.js               data menu dari registry plugin
  help/engine.js               data pusat bantuan
src/utils/                     jid, identity, myfunc (helper umum)
src/database/                  file JSON: users, groups, settings, identity, owner, premium
test/                          test suite (node --test)
docs/ARCHITECTURE.md           arsitektur, kontrak modul, roadmap
```

## Catatan

- Database ditulis ke disk secara debounced; dirty hanya dibersihkan setelah write sukses, kegagalan tulis otomatis di-retry, dan `flushAll` sinkron dijalankan saat SIGINT/SIGTERM sehingga aman dimatikan dengan Ctrl-C.
- Folder `session/` berisi kredensial WhatsApp — jangan dibagikan atau di-commit.
- Identitas user didukung penuh untuk PN maupun LID; JID grup tidak pernah dipakai sebagai identitas user.
- Repo ini berisi 10 plugin inti (menu, sc, owner/premium management, eval, shell). Bila kamu punya arsip plugin lama yang hilang, letakkan di `plugins/` — hot reload akan mendaftarkannya otomatis.
