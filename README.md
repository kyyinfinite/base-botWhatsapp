<div align="center">

  <img src=".github/assets/base-wa-esm.svg" alt="Base WA ESM" width="560">

  <h1>Base WA ESM</h1>

  <p><strong>A modular, extensible WhatsApp bot framework powered by Baileys and JavaScript ESM.</strong></p>

  <p>
    <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=nodedotjs&logoColor=white" alt="Node.js 20+"></a>
    <a href="https://github.com/WhiskeySockets/Baileys"><img src="https://img.shields.io/badge/Baileys-7.0.0--rc14-25D366?logo=whatsapp&logoColor=white" alt="Baileys 7.0.0-rc14"></a>
    <img src="https://img.shields.io/badge/JavaScript-ESM-F7DF1E?logo=javascript&logoColor=222" alt="JavaScript ESM">
    <img src="https://img.shields.io/badge/Version-2.0.0-0C9B76" alt="Version 2.0.0">
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License"></a>
  </p>

  <p>
    <a href="#-features">Features</a> ·
    <a href="#-installation">Installation</a> ·
    <a href="#-plugin-development">Plugin Development</a> ·
    <a href="#-documentation">Documentation</a>
  </p>
</div>

---

## Overview

**Base WA ESM** is a developer-focused framework for building modular WhatsApp automation systems. It provides the infrastructure that a bot project commonly needs: connection lifecycle management, command dispatching, plugin loading, middleware, identity resolution, interactive message builders, persistence, scheduling, and runtime diagnostics.

The framework is designed so that developers can focus on writing plugins instead of repeatedly implementing the underlying bot infrastructure.

> **Project version:** `2.0.0`  
> **Runtime:** Node.js 20 or newer  
> **WhatsApp library:** `@whiskeysockets/baileys` `7.0.0-rc14`

## Table of contents

- [Features](#-features)
  - [Runtime and connection](#1-runtime--connection-management)
  - [Plugin system](#2-modular-plugin-system)
  - [Command and middleware](#3-command--middleware-engine)
  - [Identity resolution](#4-identity-resolution-pn--lid)
  - [Message processing](#5-message-processing-engine)
  - [Group metadata cache](#6-group-management--metadata-cache)
  - [Interactive message builders](#7-rich-message--interactive-ui-builders)
  - [Media utilities](#8-media-processing)
  - [WhatsApp services](#9-whatsapp-messaging-services)
  - [Conversation state and scheduler](#10-conversation-state--message-scheduler)
  - [Persistence](#11-database--persistence)
  - [Observability](#12-observability--diagnostics)
- [Installation](#-installation)
- [Configuration](#-configuration)
- [Plugin development](#-plugin-development)
- [Message wrapper](#-message-wrapper-examples)
- [Built-in plugins](#-built-in-plugins)
- [Project structure](#-project-structure)
- [Development and tests](#-development--testing)
- [Security notes](#-security-notes)
- [Roadmap status](#-implementation-status)
- [License](#-license)

## ✨ Features

### 1. Runtime & connection management

A lifecycle engine that manages the active WhatsApp socket and its connection state.

- WhatsApp Multi-Device authentication.
- Pairing-code and QR-code login paths.
- Automatic reconnection with exponential backoff and jitter.
- Disconnect classification and status-specific recovery.
- Single active socket ownership and duplicate-connect protection.
- Session generation guards to ignore stale socket events.
- Serialized credential writes with retry handling.
- Baileys version caching (24-hour process TTL).
- Graceful shutdown on `SIGINT` and `SIGTERM`.
- Session directory creation with restrictive `0700` permissions.
- Configurable online-presence behavior.

Disconnect handling distinguishes conditions that should stop the runtime from transient failures that can be retried. For example, logged-out, forbidden, and multi-device mismatch states do not enter an endless reconnect loop.

### 2. Modular plugin system

Features live in the `plugins/` directory and are registered by the plugin engine.

- Recursive plugin discovery.
- Automatic plugin loading at startup.
- File-watcher-based hot reload.
- Central plugin registry.
- Plugin metadata and command validation.
- Duplicate command protection.
- Custom regular-expression matching.
- Atomic plugin replacement.
- Rollback to the previous working plugin when replacement fails.
- Dynamic menu and help data derived from registered plugins.

The plugin contract is intentionally small, keeping feature development independent from most core runtime changes.

### 3. Command & middleware engine

A shared command pipeline handles parsing, lookup, access checks, and plugin execution.

**Supported plugin metadata**

| Property | Purpose |
| --- | --- |
| `command` | One command or an array of commands |
| `customPrefix` | Custom regular-expression trigger |
| `help` | Help text shown in generated help/menu output |
| `tags` | Command category |
| `description` | Short plugin description |
| `owner` | Owner-only access |
| `creator` | Creator-only access |
| `premium` | Premium access requirement |
| `group` | Group-chat-only execution |
| `private` | Private-chat-only execution |
| `admin` | Requires the sender to be a group admin |
| `botAdmin` | Requires the bot to be a group admin |
| `cooldown` | Per-user cooldown in seconds |
| `limit` | Daily usage cost (`true` means one unit) |
| `before` / `after` | Optional plugin lifecycle hooks |

**Built-in middleware capabilities**

- Owner, creator, and premium checks.
- Group and private-chat restrictions.
- Sender administrator verification.
- Bot administrator verification.
- Cooldown enforcement.
- Daily usage-limit enforcement.
- Custom middleware registration.
- Fail-closed behavior when middleware execution fails.
- Cooldown release and limit refund when a plugin fails.

### 4. Identity resolution: PN & LID

WhatsApp can represent a person using a phone-number JID (PN) or a Linked Identity JID (LID). Base WA ESM resolves these formats so access checks and user records remain consistent.

- PN ↔ LID mapping.
- Automatic mapping capture from message metadata.
- Contact and group-participant identity capture.
- Baileys signal-repository lookup integration.
- Persistent local identity mappings.
- In-flight lookup coalescing.
- Negative lookup caching.
- Identity normalization for owner, premium, limit, and cooldown checks.
- Safe fallback to LID when a phone-number mapping is not available.
- Group, broadcast, and newsletter JIDs are excluded from user identity records.

Plugins retain the familiar message fields while receiving additional identity properties such as `senderPn`, `senderLid`, `identityNumber`, `identityJids`, and `identityKey`.

### 5. Message processing engine

A normalized, filtered message pipeline helps prevent duplicate execution and handles modern WhatsApp message wrappers.

- Ephemeral-message unwrapping.
- View-once message unwrapping, including supported V2 variants.
- Document-with-caption wrapper handling.
- Quoted-message normalization.
- Text extraction from conversations, media captions, and supported interactive replies.
- Button-response command parsing.
- Configurable command prefixes.
- Prefixless single-word command matching.
- Custom regex plugin matching.
- Broadcast, status, newsletter, and internal echo filtering.
- Duplicate-message protection with a 30-second in-memory TTL.
- Per-chat sequential execution.
- Parallel execution across different chats.
- Queue overflow protection.
- Isolated plugin error reporting.

**Concurrency model:** messages belonging to the same chat are processed in order. Different chats can progress independently. The queue limits pending work per chat to avoid unbounded backlog.

### 6. Group management & metadata cache

Group metadata is cached to reduce repeated WhatsApp metadata requests.

- Five-minute default cache TTL.
- LRU-style capacity of up to 500 groups.
- Deep-cloned metadata returned to consumers.
- Event-driven invalidation on group and participant updates.
- Cached metadata hook for the Baileys socket.
- Reuse by group dispatch and administrator middleware.
- Cache statistics for diagnostics.
- Safe behavior when metadata retrieval fails.

### 7. Rich message & interactive UI builders

The message wrapper library is available through:

```js
import {
  Button,
  ButtonV2,
  Carousel,
  AIRich,
  Foad,
  Foad2,
  Toolkit
} from './src/lib/message/wrapper.js'
```

| Builder | Built-in capabilities |
| --- | --- |
| `Button` | Native-flow interactive messages, URL buttons, reply buttons, copy buttons, selection menus, image headers |
| `ButtonV2` | Classic WhatsApp buttons, title, subtitle, body, footer, thumbnail, raw buttons |
| `Carousel` | Multiple interactive cards with media headers, descriptions, and buttons |
| `AIRich` | Rich AI-style responses with text, code, tables, images, videos, HTML, sources, suggestions, and editing |
| `Foad` | Embedded HTML widget messages |
| `Foad2` | Fullscreen HTML widget messages with title, preview title, and tabs |
| `Toolkit` | Media resolution, image resizing, HTTP buffer fetching, video utilities, and HTML payload helpers |

These builders provide a reusable presentation layer for plugins without requiring every plugin to construct low-level Baileys payloads itself.

### 8. Media processing

The built-in `Toolkit` provides common media helpers.

- HTTP/HTTPS buffer fetching.
- URL scheme validation.
- Default 30-second request timeout.
- Default 50 MB download limit.
- Content-Length checks before reading a response.
- Streaming size enforcement and cancellation.
- Axios timeout and response-size limits in shared HTTP helpers.
- Image resizing through Sharp.
- MP4 duration extraction.
- MP4 preview generation through FFmpeg utilities.
- Media resolution to supported URL, buffer, or base64 forms.

> Media protection applies to the framework's shared utilities. Plugins that implement their own network requests must enforce their own timeout, size, and URL validation policies.

### 9. WhatsApp messaging services

Reusable messaging operations are available in `src/services/whatsapp-service.js`.

- Send messages.
- Reply to messages.
- React to messages.
- Edit sent messages.
- Delete messages for everyone.
- Forward messages.
- Set WhatsApp presence.
- Send and cancel typing indicators.
- Mark messages as read.

The existing plugin context helpers remain available, so plugins do not need to call the service layer directly for every common operation.

### 10. Conversation state & message scheduler

**Conversation state**

Temporary state is stored by chat and state name, making multi-step interactions easier to implement.

- State isolation by `(chatKey, name)`.
- Five-minute default TTL.
- Lazy expiration and periodic sweeping.
- LRU capacity of up to 1,000 entries.
- Clear one state or all state for a chat.
- Input validation for state keys and TTL.

**Message scheduler**

- One-time scheduled messages.
- Repeating interval messages.
- Persistent job storage in `schedules.json`.
- Job restoration after restart.
- In-flight execution guard to prevent duplicate concurrent sends.
- Retry handling for failed one-time messages (up to three attempts).
- Job cancellation and listing.
- 30-second scheduler tick.

The current scheduler supports one-time and interval-based jobs. Calendar cron expressions are not currently implemented.

### 11. Database & persistence

The JSON persistence layer provides local storage for runtime records.

**Built-in collections**

- `users.json`
- `groups.json`
- `settings.json`
- `identity.json`
- `messages.json`
- `schedules.json`

**Persistence behavior**

- In-memory collection cache.
- Debounced writes (250 ms).
- Atomic temporary-file-and-rename writes.
- Dirty-state tracking.
- Automatic write retry with bounded backoff.
- `flushAll()` for controlled shutdown.
- Configurable database location through `WA_DATABASE_DIR`.
- Throttled `lastSeen`-only persistence.
- Immediate persistence for operational changes such as usage-limit updates.

**Outgoing message store**

- Captures outgoing message echoes.
- Stores the message proto content required by Baileys retry handling.
- LRU capacity of up to 500 entries.
- One-hour TTL.
- Persistent storage and reload across process restarts.
- Expired entries are pruned during access/cleanup.

### 12. Observability & diagnostics

Runtime status can be inspected without adding repeated instrumentation to each subsystem.

- Structured debug, info, warning, and error logs.
- Subsystem and event labels.
- 500-entry in-memory ring buffer.
- Automatic log-data sanitization.
- Log filtering by level and subsystem.
- Connection status and reconnect statistics.
- Queue key and pending-task statistics.
- Identity resolver statistics.
- Group-cache statistics.
- Message-store statistics.
- Conversation and scheduler statistics.
- Process uptime, PID, Node.js version, and memory usage.
- Human-readable diagnostic report generation.

Main APIs:

```js
import {
  getRuntimeHealth,
  formatDiagnosticReport
} from './src/services/health.js'
```

The logger and health APIs are designed for on-demand diagnostics. Logs are in-memory and are cleared when the process exits.

---

## 📥 Installation

### Requirements

- **Node.js 20+**
- npm
- A WhatsApp account for pairing

### 1. Clone the repository

```bash
git clone https://github.com/kyyinfinite/base-wa-esm.git
cd base-wa-esm
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure the bot

Open `config.json` and update the owner and bot settings. See [Configuration](#-configuration).

### 4. Start

```bash
npm start
```

On first startup, the runtime requests the phone number used for pairing when pairing-code mode is enabled. If QR mode is configured, the QR data is presented in the terminal.

After a successful connection, the plugin stack is initialized. Send `.menu` to the bot to view the generated command menu.

## ⚙️ Configuration

The repository's current `config.json` uses the following fields:

```json
{
  "botName": "kyyinfinite",
  "ownerName": "Your Name",
  "creator": [
    "628xxxxxxxxxx"
  ],
  "prefix": [
    ".",
    "#",
    "!",
    "/"
  ],
  "botMode": "public",
  "dailyLimit": 10,
  "usePairingCode": true,
  "accessDenied": {
    "owner": "Perintah ini hanya dapat digunakan oleh owner.",
    "creator": "Perintah ini hanya dapat digunakan oleh creator.",
    "premium": "Perintah ini hanya dapat digunakan oleh pengguna premium."
  }
}
```

| Field | Description |
| --- | --- |
| `botName` | Bot display name used by menu/help output |
| `ownerName` | Owner display name |
| `creator` | Array of creator phone numbers |
| `prefix` | Accepted command prefixes |
| `botMode` | `public` or `self` |
| `dailyLimit` | Default daily usage limit |
| `usePairingCode` | `true` for pairing code; `false` for QR login |
| `accessDenied` | Custom access-denied messages |

Owner and premium records are maintained in:

- `src/database/owner.json`
- `src/database/premium.json`

Manage them using the built-in owner commands described below.

## 🧩 Plugin development

All bot features are implemented as JavaScript ESM plugins inside `plugins/`. Plugins are discovered recursively and watched for changes.

### Basic plugin

Create `plugins/general/hello.js`:

```js
let handler = async (m, { conn, text }) => {
  await m.reply(`Hello! ${text || 'Welcome.'}`)
}

handler.command = ['hello', 'hi']
handler.help = ['hello']
handler.tags = ['general']
handler.description = 'Send a greeting'

export default handler
```

The plugin becomes available through the plugin loader. Existing plugin files can be edited and hot-reloaded without restarting the runtime.

### Owner-only plugin

```js
let handler = async (m) => {
  await m.reply('Owner access granted.')
}

handler.command = ['ownerinfo']
handler.owner = true

export default handler
```

### Group-admin plugin

```js
let handler = async (m) => {
  await m.reply('This command requires group admin access.')
}

handler.command = ['admincheck']
handler.group = true
handler.admin = true

export default handler
```

### Cooldown and usage limit

```js
let handler = async (m) => {
  await m.reply('Command executed.')
}

handler.command = ['limited']
handler.cooldown = 10
handler.limit = 1

export default handler
```

### Custom-prefix plugin

```js
let handler = async (m, { text }) => {
  await m.reply(`Custom trigger received: ${text}`)
}

handler.customPrefix = /^hello/

export default handler
```

**Plugin handler signature**

```js
async (m, {
  conn,
  args,
  text,
  command,
  prefix,
  notifReply,
  accessDenied,
  context
}) => {}
```

Use `let handler` and `export default handler` to follow the existing plugin convention.

## 💬 Message wrapper examples

### Native-flow button

```js
import { Button } from '../../src/lib/message/wrapper.js'

let handler = async (m, { conn }) => {
  await new Button(conn)
    .setBody('Welcome to Base WA ESM')
    .setFooter('Modular WhatsApp Framework')
    .addUrl('GitHub', 'https://github.com/kyyinfinite/base-wa-esm')
    .addReply('Help', 'help')
    .send(m.chat)
}

handler.command = ['button']
export default handler
```

### AI-rich response

```js
import { AIRich } from '../../src/lib/message/wrapper.js'

let handler = async (m, { conn }) => {
  await new AIRich(conn)
    .addText('Here is a structured response.')
    .addCode('console.log("Hello, Base WA ESM")', 'javascript')
    .send(m.chat)
}

handler.command = ['rich']
export default handler
```

## 🧰 Built-in plugins

The repository currently includes **10 plugins**:

| Category | Plugin | Purpose |
| --- | --- | --- |
| General | `menu.js` | Generated command menu |
| General | `sc.js` | Source-code information/link |
| Owner | `addowner.js` | Add an owner |
| Owner | `delowner.js` | Remove an owner |
| Owner | `addprem.js` | Add a premium user |
| Owner | `delprem.js` | Remove a premium user |
| Owner | `public.js` | Switch to public mode |
| Owner | `self.js` | Switch to self mode |
| Shell | `eval.js` | Execute JavaScript expressions |
| Shell | `shell.js` | Execute system shell commands |

> **Security:** `eval` and `shell` are highly privileged capabilities. They can execute arbitrary code or operating-system commands. Keep them restricted to trusted owners, and remove or disable them if they are not required.

## 🗂 Project structure

```text
base-wa-esm/
├── index.js
├── config.json
├── package.json
├── package-lock.json
│
├── plugins/
│   ├── general/
│   ├── owner/
│   └── shell/
│
├── src/
│   ├── core/
│   │   ├── app/             # Socket lifecycle and reconnect
│   │   ├── context/         # Plugin execution context
│   │   ├── dispatcher/      # Message and command dispatch
│   │   ├── errors/          # Centralized error reporting
│   │   ├── events/          # Internal event engine
│   │   ├── message/         # Message normalization
│   │   ├── middleware/      # Access and execution middleware
│   │   ├── plugin/          # Plugin loader and registry
│   │   ├── queue/           # Per-chat queue and deduplication
│   │   └── scheduler/       # Daily limit reset
│   │
│   ├── database/            # Runtime JSON records
│   ├── lib/
│   │   └── message/         # Interactive message builders
│   ├── services/
│   │   ├── database/        # JSON persistence services
│   │   ├── help/            # Help data engine
│   │   ├── access.js        # Owner and premium access
│   │   ├── config.js        # Configuration service
│   │   ├── conversation-state.js
│   │   ├── group-cache.js
│   │   ├── health.js
│   │   ├── identity-resolver.js
│   │   ├── logger.js
│   │   ├── menu-engine.js
│   │   ├── message-store.js
│   │   ├── scheduler.js
│   │   └── whatsapp-service.js
│   └── utils/               # JID, identity, and common helpers
│ 
└── test/                    # Node.js native test suite
```

## 🧪 Development & testing

The project uses Node.js's built-in test runner.

```bash
# Start the bot
npm start

# Run all tests
npm test

# Check the entry point syntax
npm run check
```

### Recorded verification

The implementation manifest (`MANIFEST_PHASE1-9.md`) records the Phase 9 verification results:

| Check | Recorded result |
| --- | ---: |
| Test suites | 58 |
| Tests | 353 |
| Passed | 353 |
| Failed | 0 |
| JavaScript syntax check | Passed |
| npm audit vulnerabilities | 0 |

These are the results recorded in the supplied implementation manifest, not a claim that the tests were freshly executed when this README was generated. Run the commands above against your current checkout to verify its state.

## 🔐 Security notes

Base WA ESM includes access middleware, input validation in plugin registration, restrictive session-directory permissions, sanitized diagnostic logs, bounded media downloads, atomic persistence, and queue overflow protection.

A few deployment considerations remain important:

1. **Protect credentials.** Never commit the `session/` directory, authentication credentials, or private deployment data.
2. **Treat shell capabilities as privileged.** `eval` and `shell` can execute arbitrary code and commands. Restrict access and remove these plugins if unnecessary.
3. **Review untrusted media URLs.** Shared media helpers restrict schemes, timeouts, and download size, but the current implementation does not provide a complete internal-network SSRF deny-list. Add deployment-level egress controls or an explicit allowlist when accepting untrusted URLs.
4. **Keep dependencies updated.** Review dependency advisories and run `npm audit` regularly.
5. **Use a trusted environment.** This project automates a personal WhatsApp account through an unofficial Web protocol library. Account and platform behavior may change.


## 📄 License

This project declares the **MIT License** in `package.json`. See the repository's `LICENSE` file for the complete license text.

---

<div align="center">

  <strong>Base WA ESM</strong><br>
  Build features. Keep the runtime modular.

  <sub>Built with JavaScript ESM and Baileys.</sub>

</div>
