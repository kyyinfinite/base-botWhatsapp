# Base Bot WhatsApp

A modular WhatsApp bot base built with **Node.js, ESM, and Baileys**.

Designed to be simple to extend while keeping the internal bot architecture organized and the plugin system independent from the core.

---

## Features

- Node.js ESM
- Baileys
- Dynamic plugin loader
- Plugin hot reload
- Command system
- Owner & premium system
- JSON database
- ButtonV2 message builder
- Rich Response support
- FOAD HTML widget support
- HTML-based interactive games
- Snippet service
- Modular core architecture
- Custom utilities and services

---

## Requirements

- Node.js >= 20
- npm

---

## Installation

Clone the repository and install the dependencies:

```bash
git clone https://github.com/kyyinfinite/base-botWhatsapp.git
cd base-botWhatsapp
npm install
```

Configure the bot before starting, then run:

```bash
npm start
```

---

## Configuration

The main configuration file is `config.json`.

Example:

```json
{
  "botName": "My Bot",
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
  "botMode": "public"
}
```

> **Important:** Do not put private credentials, API keys, or WhatsApp session data inside the repository.

---

## Project Structure

```
base-botWhatsapp/
│
├── index.js
├── config.json
├── package.json
├── package-lock.json
│
├── src/
│   ├── core/
│   │   ├── app/
│   │   └── handler/
│   │
│   ├── lib/
│   │   └── message/
│   │       └── wrapper.js
│   │
│   ├── services/
│   │   └── snippet/
│   │
│   ├── utils/
│   │
│   ├── database/
│   │
│   └── assets/
│       ├── markup/
│       └── media/
│
├── plugins/
│   ├── game/
│   ├── general/
│   ├── owner/
│   ├── shell/
│   └── snippet/
│
└── session/
```

### `src/core`

The internal bot engine. Contains the connection, message handler, plugin loader, and other core systems required by the bot.

### `src/lib`

Internal libraries used by the bot. The message wrapper provides builders such as:

- Button
- ButtonV2
- Carousel
- AIRich
- Foad2
- Toolkit

### `src/services`

Reusable application-level services.

### `src/utils`

General-purpose utility functions used throughout the bot.

### `src/database`

Local JSON-based persistent data.

### `src/assets`

Static assets used by the bot. Includes HTML markup and media files.

### `plugins`

The actual bot features. Plugins intentionally stay outside `src/` so the feature layer remains independent from the core engine.

---

## Plugin System

Plugins use ESM and export a default handler.

Example:

```js
const handler = async (m, { conn, prefix }) => {
    await m.reply('Hello World')
}

handler.command = ['hello']

export default handler
```

Place the plugin inside `plugins/`, for example:

```
plugins/
└── general/
    └── hello.js
```

The plugin loader automatically discovers JavaScript plugins. Changes to plugin files can also be detected and reloaded while the bot is running.

---

## ButtonV2

The base includes a message builder for creating button-based messages.

Example:

```js
import { ButtonV2 } from '../../src/lib/message/wrapper.js'

const handler = async (m, { conn }) => {
    await new ButtonV2(conn)
        .setTitle('Example')
        .setBody('Hello from ButtonV2')
        .addButton('Ping', '.ping')
        .send(m.chat)
}

handler.command = ['example']

export default handler
```

Raw buttons can also be used when a more advanced WhatsApp native-flow structure is required.

Example:

```js
.addRawButton({
    buttonText: {
        displayText: 'Choose Menu'
    },
    buttonId: 'menu',
    type: 1,
    nativeFlowInfo: {
        name: 'single_select',
        paramsJson: JSON.stringify({
            title: 'Menu',
            sections: [
                {
                    title: 'Commands',
                    rows: [
                        {
                            title: 'Owner',
                            description: 'Owner commands',
                            id: '.ownermenu'
                        }
                    ]
                }
            ]
        })
    }
})
```

---

## Rich Response

The wrapper also provides Rich Response functionality through `AIRich`. This allows plugins to build structured responses instead of manually constructing the underlying message payload.

Example:

```js
import { AIRich } from '../../src/lib/message/wrapper.js'

const rich = new AIRich(conn)

rich
    .setTitle('Example')
    .addText('Hello from Rich Response')

await rich.send(m.chat)
```

---

## FOAD

FOAD is used for HTML-based interactive widgets. It can be used to embed HTML interfaces inside a Rich Response.

Example:

```js
import { Foad2 } from '../../src/lib/message/wrapper.js'

const handler = async (m, { conn }) => {
    const foad = new Foad2(conn)

    foad
        .addTitle('Game Center')
        .setPreviewTitle('Game Center')
        .addHtml(html, {
            id: 'game',
            title: 'Game',
            url: 'https://example.com',
            trustedSources: ['example.com']
        })

    await foad.send(m.chat)
}

handler.command = ['game']

export default handler
```

---

## HTML Games

The base supports HTML-based interactive games. Current examples include:

- Asah Otak
- Susun Kata
- Pengetahuan
- TicTacToe
- Catur

Game markup is separated from the plugin logic:

```
src/
└── assets/
    └── markup/
```

This makes the HTML interface easier to maintain without mixing it directly into the plugin source.

---

## Database

The base currently uses JSON files for lightweight persistent data.

```
src/database/
├── owner.json
└── premium.json
```

This approach keeps the base simple and does not require an external database for basic usage.

---

## Development

Start the bot:

```bash
npm start
```

Plugin development can be done directly inside `plugins/`. The plugin loader is designed to detect plugin changes without requiring the entire bot architecture to be rebuilt.

---

## Architecture

The project separates the bot into two major layers:

```
WhatsApp / Baileys
        │
        ▼
┌─────────────────┐
│    src/core                │
│     Engine                 │
└───────┬─────────┘
              │
   ┌─────┴─────┐
   │           │
   ▼           ▼
Message      Plugin
System       Loader
   │           │
   │           ▼
   │      ┌──────────┐
   │      │ plugins/ │
   │      └────┬─────┘
   │           │
   │     ┌─────┼─────┐
   │     ▼     ▼     ▼
   │   game general owner
   │
   ▼
Button / Rich
Response / FOAD
```

The main principle is:

- `src/` → Internal bot engine
- `plugins/` → Bot features

This keeps the core independent from the features built on top of it.

---

## Security

Never commit the following files or data:

- `.env`
- `session/`
- Private API keys
- Private credentials
- Personal database data

For public deployments, always review:

- `config.json`
- Database files
- API credentials
- WhatsApp session files
- Owner/creator information

---

## License

This project is licensed under the MIT License.

Copyright (c) 2026 kyyinfinite

See the LICENSE file for the full license text.
