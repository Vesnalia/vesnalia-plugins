# Vercel Theme for VesnALIA

A polished Vercel-inspired theme for [VesnALIA](https://getbb.app): true-black dark
surfaces, crisp neutral borders, Geist typography, restrained blue accents,
and matching syntax, diff, file-tree, and terminal colors.

> This is an independent community theme. It is not affiliated with or
> endorsed by Vercel.

![Vercel Theme in VesnALIA dark mode](assets/screenshots/vercel-dark.png)

## Highlights

- **True-black dark mode** — `#000` content, `#0a0a0a` chrome, and carefully
  stepped `#1f1f1f` / `#262626` boundaries.
- **Clean light mode** — white content, off-white navigation, and the same
  neutral hierarchy.
- **Geist-first typography** — Geist and Geist Mono when available, with
  reliable native fallbacks.
- **Purposeful color** — Vercel blue is reserved for links, focus, and primary
  actions; status colors retain clear meaning.
- **Complete developer surfaces** — dedicated light/dark code themes plus
  coordinated chat code, diffs, file trees, and ANSI terminal colors.

## Install

Install the Git release directly (and, once its community listing is merged,
search for **Vercel Theme** in the VesnALIA Community marketplace):

```sh
alia plugin install git:https://github.com/divyesh-puri/bb-plugin-vercel-theme.git@^0.1.0
```

Then select **Vercel** under **Settings → Appearance**, or run:

```sh
alia theme set plugin:vercel-theme:vercel
```

Light/dark mode remains a per-client VesnALIA setting. The palette supports both.

<details>
<summary>Light mode preview</summary>

![Vercel Theme in VesnALIA light mode](assets/screenshots/vercel-light.png)

</details>

## Development

```sh
npm install
npm run check
npm run build
alia plugin install .
alia theme set plugin:vercel-theme:vercel
```

## Design map

| VesnALIA surface | Vercel treatment |
| --- | --- |
| Main canvas | `#000000` dark / `#ffffff` light |
| Sidebar and cards | `#0a0a0a` dark / `#fafafa` light |
| Primary text | `#ededed` dark / `#171717` light |
| Secondary text | `#a1a1a1` dark / `#666666` light |
| Borders | `#262626` dark / `#e5e5e5` light |
| Accent | `#006fee` |
| UI font | Geist |
| Code font | Geist Mono |

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
