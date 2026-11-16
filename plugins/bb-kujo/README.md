# Kujo // VesnALIA

A light and dark theme for [VesnALIA](https://getbb.app/), built from the visual language of [Kujo](https://kujolang.ai/) and its [SiteKit](https://github.com/kujolang/site-kit) design system.

Paper and ink. Hard edges. Quiet signal noise.

[Watch the 68-second walkthrough](https://github.com/kujolang/bb-kujo/releases/download/v0.2.0/bb-kujo-walkthrough.mp4) · [Screenshots](screenshots/README.md)

## Quick install

Requires **VesnALIA 0.43.x**. With VesnALIA running, run:

```sh
alia plugin install git:https://github.com/kujolang/bb-kujo.git --yes
alia theme set plugin:alia-kujo:kujo
```

Choose **Light**, **Dark**, or **System** in **Settings → Appearance**.

## The theme

- Light and dark palettes with matching editor, terminal and diff colors.
- Departure Mono for navigation and code; readable sans-serif text for conversations.
- Tabler outline icons, thin borders and restrained corners.
- Kujo’s dithered artwork with brief background glitches. Text and controls stay still.
- Visible keyboard focus and support for reduced motion.

Fonts and artwork are bundled. The theme makes no runtime network requests and includes no analytics or telemetry.

![Kujo dark theme in VesnALIA](screenshots/background-still.png)

<details>
<summary>Light mode</summary>

![Kujo light theme in VesnALIA](screenshots/light-background-still.png)

</details>

## More

New to Kujo? [Explore Kujo](https://kujolang.ai/) or browse the [SiteKit source](https://github.com/kujolang/site-kit).

[Local development](docs/development.md) · [Compatibility and known limits](docs/compatibility.md) · [Release notes](CHANGELOG.md)

Some third-party panels keep their own styles. Stock VesnALIA 0.43.0 also has a known [Monaco editor issue](docs/monaco-compatibility.md); the theme does not patch it automatically.

Remove the theme with `alia plugin remove alia-kujo`.

[MIT license](LICENSE). [Font, icon and artwork credits](THIRD_PARTY_NOTICES.md).
