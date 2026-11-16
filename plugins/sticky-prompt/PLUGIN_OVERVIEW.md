## What you get

- As soon as your message reaches the top of the chat, a two-line copy of it stays there, drawn the way VesnALIA draws your message: code, bold and links included.
- Your next message pushes it away as it comes up to the top.
- Click the pinned message to scroll back to it, even when VesnALIA has unloaded it from a long thread.
- Images in your message show as small thumbnails: up to three, then a count of the rest.
- A turn that fits on screen is left alone, because you can already see your message and the end of the reply together.
- Only messages you typed are pinned. A setting adds messages from agents, other threads and VesnALIA system notices.

## Settings

- **Pin your message to the top of the chat** turns the bar on or off.
- **Also pin messages from agents and VesnALIA** pins those messages as well as yours.

## How it works

The plugin runs in the VesnALIA app and reads the thread's messages through VesnALIA's own API with your session. It stores nothing and needs no account or external service. Images attached by address load from that address, as they do in the chat.

It finds messages through VesnALIA's chat markup, which is not a public API. If a VesnALIA update changes that markup, the bar stops showing and the chat keeps working.

## Diagnostics

`alia sticky-prompt senders <thread-id>` lists a thread's newest messages, who sent each one and whether the bar would pin it. `alia sticky-prompt images <thread-id>` checks that their images load.
