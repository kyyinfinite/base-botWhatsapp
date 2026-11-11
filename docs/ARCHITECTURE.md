# Arsitektur

Dokumen ini menjelaskan kondisi kode yang benar-benar ada, bukan rencana.

## Gambaran

Alur satu pesan:

```
Baileys (messages.upsert)
  → connect.js: filter status/BAE5, smsg(), isolation error per pesan
    → dispatcher.js handleMessage:
        normalizeMessage (teks + isButtonResponse)
        → captureFromMessage (pasangan LID-PN dari key pesan)
        → resolveSenderIdentity (sender → PN/LID via resolver)
        → flag akses dari identitas lengkap (PN + LID)
        → upsertUser / upsertGroup (capture metadata grup)
        → mode self, teks kosong, dedupe
        → messageQueue per chat
          → processMessage:
              parse (button response / custom prefix / command)
              → registry lookup
              → createContext
              → runMiddleware (owner..limit; cooldown commit di sini)
              → executePlugin (error terisolasi, limit commit,
                cooldown dilepas saat plugin gagal)
```

## Modul dan tanggung jawab

### Entry

- `index.js` — menjalankan scheduler reset limit, koneksi, dan graceful shutdown (flush database + tutup socket saat SIGINT/SIGTERM). Mencatat `unhandledRejection`.

### Runtime (`src/core/app/`)

- `connect.js` — pemilik socket dan lifecycle koneksi. Satu sesi aktif dengan state `connecting/open/closed`; `connectToWhatsApp` saat koneksi masih hidup atau sedang dibuat mengembalikan socket yang sama (lock pembuatan socket, anti koneksi ganda). Semua listener (`creds.update`, `connection.update`, `messages.upsert`, kontak) dipasang sebelum pairing dimulai karena `requestPairingCode()` sendiri memicu `creds.update`. Penyimpanan kredensial diserialkan lewat satu antrean promise; sebelum socket pengganti dibuat antrean ditunggu sampai selesai (gagal simpan dilaporkan dan dicoba ulang sekali), dan auth state dari `useMultiFileAuthState()` dipakai ulang oleh socket baru sehingga pairing tidak diminta lagi setelah registered. Keputusan pairing memakai `state.creds.registered`, bukan `sock.authState`. Readline dibuat malas hanya saat pairing dibutuhkan dan dilepas bila socket tertutup saat prompt masih menunggu. Event socket lama diabaikan lewat generation counter dan listener-nya dilepas saat close. Reconnect memakai satu timer yang sengaja tidak di-`unref` (timer itulah yang menjaga proses Node tetap hidup); bila pembuatan socket gagal, retry tetap dijadwalkan sehingga runtime tidak berhenti. Plugin hanya diinisialisasi sekali pada koneksi open pertama, reconnect tidak mengulanginya. `closeActiveSocket` menaikkan generation, membatalkan reconnect terjadwal, melepas binding resolver, membersihkan listener, dan menunggu antrean simpan kredensial. Koneksi dibuat lewat `createSocket` yang bisa di-inject sehingga lifecycle bisa diuji tanpa koneksi asli.
- `reconnect.js` — fungsi murni `classifyDisconnect`, `computeBackoff`, `reconnectDelayFor`, `shouldReconnect`, diuji tanpa koneksi asli. Strategi per status: 515 (`restartRequired`, normal saat pairing) reconnect langsung tanpa backoff dan tidak dihitung sebagai kegagalan (jeda tetap 1 detik hanya setelah 5 restart beruntun tanpa pernah open); 408/428/503 dan status tak dikenal memakai backoff eksponensial 2s → 60s + jitter tanpa batas jumlah retry; 440 memakai backoff panjang 30s → 5 menit; 401 tidak reconnect dan sesi ditandai logout.

### Dispatcher (`src/core/dispatcher/`)

- `dispatcher.js` — orkestrasi pesan (di atas). Identitas pengirim dihitung lewat `resolveSenderIdentity` (resolver): pesan via LID dipasangkan dengan PN-nya bila mapping tersedia, JID grup tidak pernah jadi identitas. Hasilnya terpasang di `m.senderPn`, `m.senderLid`, `m.identityNumber`, `m.identityKey`, `m.chatKey` (chat pribadi dinormalisasi ke PN). Flag owner/premium/premium dicek terhadap seluruh nomor identitas sehingga user yang sama dikenali baik kirim via LID maupun PN. Metadata grup yang diambil juga dimanfaatkan untuk capture mapping participant.
- `parse.js` — `parseCommand` (prefix + command + args, atau command tanpa prefix satu kata), `parseButtonResponse` (id tombol, prefix opsional), `matchPatternPlugin` (anchored menang atas loose). Alur button response dan command biasa memakai createContext, middleware, dan executePlugin yang sama.

### Plugin (`src/core/plugin/`)

- `registry.js` — satu sumber kebenaran untuk plugin terdaftar. Kontrak: fungsi async dengan `handler.command` (string/array) atau `handler.customPrefix` (RegExp); metadata divalidasi tipe per field. `registerPlugin` atomik: validasi dulu, baru mutasi. Collision command dicatat dan owner pertama dipertahankan. `replacePlugin` untuk hot reload: handler baru divalidasi DULU sebelum plugin lama disentuh; jika pendaftaran baru gagal, rollback memulihkan handler lama beserta metadata. `unregisterPlugin`/`removeKeys` memverifikasi ownership SEBELUM menghapus key (command string maupun pattern symbol), jadi keys basi milik file lain tidak pernah menghapus command plugin lain. Command RegExp didaftarkan sebagai pattern plugin, bukan diabaikan.
- `loader.js` — discovery rekursif, import dengan cache-busting, `pluginCache` (file → keys registry), watcher `fs.watch` per direktori dengan debounce 200ms, deteksi direktori baru. Plugin yang gagal import/validasi tidak mengubah registry (versi lama tetap jalan).

### Middleware (`src/core/middleware/`)

- `engine.js` — rantai tetap: owner, creator, premium, group, private, admin, botAdmin, cooldown, limit. Kontrak middleware: `async (ctx, handler) => null | true | { allowed: false, title?, message? }`. `useMiddleware(fn)` menambah middleware kustom setelah bawaan, mengembalikan fungsi dispose. Middleware yang melempar error → fail-closed dengan pesan ke user.
- `cooldown.js` — pemeriksaan dan commit dipisah: `checkCooldown` (pure check + sweep entry kedaluwarsa), `commitCooldown` (reservasi atomik, aman untuk eksekusi bersamaan), `releaseCooldown`. Middleware melakukan check+commit lalu memasang `ctx._cooldownRelease`; dispatcher memanggil release saat plugin gagal sehingga kegagalan tidak meninggalkan cooldown permanen. Key memakai identitas ternormalisasi (`identityKey`) dan chat ternormalisasi (`chatKey`) sehingga LID dan PN dari user yang sama berbagi cooldown.
- `admin.js` / `botAdmin.js` — state admin grup dihitung sekali per eksekusi dan dicache ke `ctx.m`.

### Context (`src/core/context/`)

- `createContext.js` — objek context untuk plugin: `conn`, `m`, `args`, `text`, `command`, `prefix`, `user`, `group`, flag akses, `send`, `reply`, `react`, `notifReply`, `accessDenied`, `wrapper`, plus properti identitas `senderPn`, `senderLid`, `identityNumber`, `identityKey`, `identityJids`, `chatKey`. `m` dan `conn` tetap API utama; context hanya pelengkap.

### Queue dan dedupe (`src/core/queue/`)

- `engine.js` — antrian serial per chat, maksimal 50 pending per key, error task tidak menghentikan antrian.
- `dedupe.js` — id pesan dengan TTL 30 detik dan batas ukuran.

### Message wrapper (`src/lib/message/`)

- `wrapper.js` — pintu masuk publik; mengekspor `VERSION`, `Button`, `ButtonV2`, `Carousel`, `AIRich`, `Toolkit`, `Foad`, `Foad2`. Import plugin lama tetap kompatibel.
- `base-builder.js`, `button.js`, `button-v2.js`, `carousel.js`, `airich.js`, `foad.js` — implementasi per jenis builder. `foad.js` memakai `FoadBase` agar Foad (embedded) dan Foad2 (fullscreen) tidak menduplikasi build/send/sendEdit.
- `airich-tokenizer.js` — tokenizer kode untuk blok kode AIRich.
- `toolkit.js` — utilitas statis; termasuk `buildBotHtml` yang dipakai plugin game/ping untuk kirim HTML via `relayMessage`.
- `utils.js`, `errors.js`, `version.js` — helper inline entity, error class khusus AIRich, konstanta versi.

### Services (`src/services/`)

- `config.js` — cache `config.json` dengan invalidasi mtime; `updateConfig` menulis atomik (tmp + rename) dan menyegarkan cache. Dipakai engine dan plugin (`self`/`public`).
- `access.js` — daftar owner/premium dengan cache mtime, `add/remove/has/numbers` (bandingkan per digit nomor, bukan string JID).
- `identity-resolver.js` — resolver LID ↔ PN. Sumber utama mapping adalah store resmi Baileys (`sock.signalRepository.lidMapping`, API rc14: `getLIDForPN`, `getLIDsForPNs`, `getPNForLID`, `getPNsForLIDs`, `storeLIDPNMappings`). Auto-capture dari pesan (`remoteJid`+`remoteJidAlt`, `participant`+`participantAlt`, `senderPn` bila ada), kontak (`id`/`lid`/`phoneNumber`), dan metadata grup (participants, owner/ownerPn, author/authorPn). Cache lokal (Map dua arah, dibatasi 10.000 entry) menyimpan mapping yang sudah diketahui dan dipersist ke `database/identity.json` sehingga tetap ada setelah restart; negative cache ber-TTL mencegah lookup berulang ke Baileys untuk identitas yang belum dikenal; lookup sejenis digabung (in-flight dedupe). Semua operasi menangkap/menyimpan error-sendiri sehingga message handler tidak pernah gagal karenanya. Socket di-bind lewat `setResolverSocket` sehingga resolver hanya memakai socket aktif.
- `database/json.js` — collection JSON dengan cache memori. Semua mutasi (`set`, `touch`, `delete`, `setAll`) memakai mekanisme persistence yang sama: tandai dirty + tulis debounced 250ms. Dirty hanya dibersihkan SETELAH write sukses; write gagal tetap dirty untuk retry (backoff sampai 30 detik, maksimal 5 percobaan otomatis, data tetap di-flush saat shutdown). Tulis memakai atomic replacement (tmp + rename). `flushDirty` deterministik untuk test, `flushAll` sinkron untuk shutdown. Direktori bisa dioverride lewat `WA_DATABASE_DIR` (dipakai test).
- `database/users.js` — key user dari JID personal dengan namespace terjaga: PN jadi key digit nomor, LID jadi key `user@lid` (digit LID tidak pernah dianggap nomor telepon); bila mapping LID→PN sudah diketahui cache resolver, key otomatis konvergen ke PN. `getUserKey` menolak `@g.us`, `@broadcast`, `@newsletter`. Upsert menjaga `firstSeen` dan limit.
- `database/groups.js` — record grup per `@g.us`.
- `menu-engine.js` — daftar kategori + command dari registry, difilter flag akses. Dipakai plugin menu.
- `help/engine.js` — konten bantuan statis + fitur terdaftar otomatis. Dipakai perintah `.help`.
- `snippet/kyysnippet.js` — klien API kyyinfinite dengan validasi input.

### Utils (`src/utils/`)

- `jid.js` — dekode/normalisasi JID via helper resmi Baileys (`isPnUser`, `isLidUser`, `isJidGroup`, `isJidBroadcast`, dst).
- `identity.js` — util JID murni tanpa socket: `toNumber` (hanya identifier berbasis PN; LID/grup/broadcast/newsletter ditolak, device dibuang), `toUserJid`, `toLidJid`, `isPersonalJid` (PN/LID/hosted via helper Baileys), `normalizePersonalJid` (mempertahankan tipe JID, hanya buang device), `getConfiguredNumbers`.
- `myfunc.js` — helper umum untuk plugin: `smsg` (normalisasi pesan Baileys; mempertahankan `remoteJidAlt`/`participantAlt` untuk kebutuhan resolver), `runtime`, `getTime`, `parseMention`, dll. `getBuffer`/`fetchJson` melempar error, bukan mengembalikan objek error.

## Kontrak plugin

```js
let handler = async (m, { conn, args, text, command, prefix, notifReply, accessDenied, context }) => {}

handler.command = ['cmd', 'alias']   // atau handler.customPrefix = /^regex/
handler.owner = true                 // metadata opsional lain
export default handler
```

Aturan: `let handler`, ESM, `export default handler`, `m` dan `conn` sebagai API utama, helper chain (`set/add/clear/build/send`). Tidak ada Plugin Builder API dan tidak ada pengganti `m`/`conn`.

## Keputusan desain penting

1. **Modularisasi di engine, bukan di API plugin.** Plugin tetap satu fungsi dengan metadata; kompleksitas (registry, loader, dispatcher, middleware) hidup di `src/core`.
2. **Fail-safe.** Error plugin, error middleware, error pesan, dan error load plugin semuanya terisolasi dan dilaporkan lewat `errors/engine.js` + event bus; tidak ada yang menjatuhkan proses. Error dari resolver/Baileys mapping store juga tertelan tanpa menggagalkan handler.
3. **Satu alur eksekusi.** Command biasa, command tanpa prefix, custom prefix, dan button response melewati pipeline yang sama sehingga middleware dan context konsisten.
4. **Ownership command.** Setiap key command dimiliki tepat satu file; unregister/reload file tidak pernah menyentuh command milik file lain, termasuk saat dipanggil dengan keys basi.
5. **Konfigurasi dan daftar akses ber-cache.** Tidak ada pembacaan sinkron config/owner/premium per pesan; plugin yang mengubah data memakai service agar cache tetap benar.
6. **Database tulis debounced dengan jaminan persist.** Semua mutasi menandai dirty; dirty hanya hilang setelah write sukses; shutdown melakukan flush terakhir.
7. **LID sebagai identifier kelas satu.** PN bukan satu-satunya identitas: pesan LID tetap diproses meski mapping belum ada, dan begitu mapping diketahui (dari alt field pesan, kontak, metadata grup, atau store Baileys) user yang sama dikenali lintas LID/PN untuk akses, limit, cooldown, dan record user.
8. **Baileys tetap sumber mapping utama.** Cache lokal hanya pelengkap; penulisan mapping selalu lewat API resmi `signalRepository.lidMapping`, tidak pernah menyentuh struktur internal auth state.

## Batasan yang diketahui

- Mapping LID↔PN bergantung pada ketersediaan data: tanpa alt field, kontak, metadata grup, atau mapping di store Baileys, user LID dicatat terpisah dari PN-nya (tetap valid sebagai identitas).
- Event `lid-mapping.update` Baileys rc14 hanya dipancarkan dari jalur notifikasi linked-profiles yang sempit, jadi tidak dijadikan sumber utama; auto-capture dari pesan/kontak/metadata adalah jalur utama.
- Repository hanya berisi 10 plugin (general/menu, general/sc, owner×6, shell×2). Audit menyebut repositori awal memiliki 22 plugin, tetapi arsip sumbernya tidak tersedia sehingga 12 plugin lain tidak dapat dipulihkan tanpa menebak — perlu arsip original untuk memulihkannya.
- Kategori System pada menu kosong karena plugin shell/eval berbasis `customPrefix` (memang tidak punya command).
- Fitur snippet butuh API key `config.kyyinfinite.apikey`; tanpa itu, plugin snippet melempar pesan error yang jelas.
- Testing koneksi WhatsApp asli (pairing, kirim pesan nyata) tidak dilakukan di lingkungan pengembangan; yang diuji adalah seluruh logic engine dengan fake conn + mock mapping store, termasuk simulasi restart lewat proses anak.

## Roadmap status

| Fase | Status |
| --- | --- |
| 0. Baseline & architecture contract | Selesai — audit + test infra (`node --test`) |
| 1. Plugin architecture | Selesai — validasi, registry atomic + ownership check, safe reload + rollback metadata, watcher |
| 2. Message wrapper ecosystem | Selesai — wrapper.js dipecah 12 modul, entry publik dipertahankan, Foad/Foad2 dedup |
| 3. Core dispatcher | Selesai — dispatcher + parse terpisah, alur button/command disatukan, integrasi resolver |
| 4. Context & middleware | Selesai — error isolation, registrasi kustom, urutan konsisten, cooldown check/commit/release |
| 5. Baileys runtime | Selesai — penanganan 515, strategi reconnect per status, persistensi kredensial berurutan, anti koneksi ganda, pairing via `state.creds.registered`, graceful shutdown, event cleanup |
| 6. Database & services | Selesai — config service, access service, debounced flush + retry, key guard namespace LID |
| 7. Queue & scheduler | Selesai — audit + test perilaku antrian, dedupe, reset limit |
| 8. Security & performance | Selesai — identitas anti-JID-grup, validasi metadata, cache, listener hygiene |
| 9. Documentation & DX | Selesai — README, dokumen arsitektur ini |
| 10. Automatic LID↔PN resolver | Selesai — auto-capture pesan/kontak/grup, store Baileys rc14, cache lokal persist, integrasi end-to-end |
