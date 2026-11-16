# E Corp theme for VesnALIA

E Corp is a cold corporate workstation theme for [VesnALIA](https://getbb.app). It pairs smoky petroleum-blue surfaces, restrained cyan illumination, steel dividers, compact geometry, and an illuminated focus seam with matching code, diff, file-tree, and terminal colors.

The palette includes coordinated dark and light modes: the same window, the same illumination low and centre, at two exposures. IBM Plex Sans carries conversation and navigation, IBM Plex Mono carries code and operational metadata, and the bundled Pierre-compatible themes keep syntax surfaces aligned with the app palette.

This is an unofficial fan-made theme. It is not affiliated with or endorsed by the creators or rights holders of *Mr. Robot*.

## Install

```sh
alia plugin install git:https://github.com/xcke/bb-plugin-e-corp.git@^0.1.0
alia theme set plugin:e-corp:e-corp
```

The theme can also be selected under **Settings → Appearance** after installation.

## Develop

Edit `source/theme.src.css`, then regenerate and validate the distributable stylesheet:

```sh
npm install
npm run check
```

`source/build.sh` embeds the fonts and texture into `themes/e-corp.css`, stripping the source comments on the way. The build refuses to replace the output if it reaches VesnALIA's stylesheet limit of 256,000 characters — past that, VesnALIA rejects the theme at `alia theme set` with a bare `Invalid theme id`.

For local testing:

```sh
alia plugin install .
alia theme set plugin:e-corp:e-corp
```

## Assets

IBM Plex font files are distributed under the SIL Open Font License; see `source/assets/OFL.txt`. The wallpaper and derived texture are included with redistribution permission from the theme author. See `ASSET_NOTICES.md` for details.

## License

The plugin is available under the MIT License. IBM Plex remains covered by its bundled SIL Open Font License.
