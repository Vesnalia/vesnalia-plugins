# alia-plugin-realtime-gateway

A connection plugin for the Voice Mode VesnALIA plugin. Voice Mode asks it for a
realtime session, and it hands back one borrowed from the Vercel AI Gateway,
so your voice sessions bill through a gateway key instead of putting an OpenAI
key on the VesnALIA host.

## What it does

Voice Mode discovers installed plugins that publish a `realtimeConnection` rpc
and asks one of them where to connect. This plugin answers with a POST to the
gateway's client-secrets endpoint, which mints a single-use secret for the model
you configured. It returns the gateway's realtime URL with that secret already
attached to the WebSocket handshake.

The secret never touches the browser: it is created server-side, passed in the
handshake, and spent by the session. A fresh secret is minted per session, so
Voice Mode's `refresh` request is a no-op here.

## Setup

1. Create a Vercel AI Gateway key at `vercel.com` → AI Gateway → API keys.
   Paste it into **Settings → Plugins → Realtime Gateway**, or set it from a
   shell with `alia plugin config realtime-gateway`.
2. Set `model` to a gateway realtime id. `openai/gpt-realtime-mini` is the
   default and the cheapest option; `openai/gpt-realtime-2` also works.
3. Leave Voice Mode's **Connection** setting on `auto`, or set it to `plugin`
   to pin this provider. With `plugin`, Voice Mode shows an error when this
   plugin cannot mint a secret rather than silently falling back to another
   provider.

## Check it works

```sh
alia realtime-gateway test
```

The command mints a secret and opens one real session, replaying the same
`session.update` Voice Mode sends. It prints the model, when the minted secret
expires, and the first server events the gateway returns, then closes. If you
see events instead of a timeout, the handshake works.

Override the model for one run with `--model`:

```sh
alia realtime-gateway test --model openai/gpt-realtime-2
```

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `aiGatewayApiKey` | empty | Secret. Falls back to `AI_GATEWAY_API_KEY`. |
| `model` | `openai/gpt-realtime-mini` | Realtime model id. |
| `teamIdOrSlug` | empty | Only when the key is scoped to one Vercel team. |

## Requirements

- VesnALIA 0.46 or newer.
- A Vercel account with AI Gateway access and usage billing enabled.
- The Voice Mode plugin, installed and configured to use this provider.
- No OpenAI key is needed on this host.

## Limits

The gateway's realtime endpoint does not accept an Authorization header, so the
credential rides the `Sec-WebSocket-Protocol` header instead. That makes this
plugin dependent on Vercel's realtime protocol as it stands today, version
`0.0.1`. If Vercel changes that protocol, sessions fail until the plugin is
updated.

This is one provider path only. Voice Mode's own OpenAI API key path still works
and is untouched by this plugin.

## Develop

```sh
npm install
npm run typecheck
alia plugin build
alia plugin install . --yes
```
