# Native VesnALIA marketplace

This repository is both a plugin source and a VesnALIA marketplace. Its root
`marketplace.json` lists `zcode`, with native store branding, author metadata,
an overview, and a Git source pointing back to this repository's `main` branch.
Compatibility remains defined by the plugin's `package.json` engine ranges.

## Add and install

In **Settings → Plugin marketplaces**, paste one of these into **Marketplace source**:

```text
https://raw.githubusercontent.com/dpolishuk/bb-zcode/main/marketplace.json
```

```text
git:https://github.com/dpolishuk/bb-zcode.git@main
```

Click **Add**, then find **ZCode** from **ZCode for VesnALIA** in the
plugin store and click **Install**. Review VesnALIA's resolved source confirmation.
The plugin runs code locally, just like a direct native plugin installation.

The equivalent CLI commands are:

```sh
alia marketplace add git:https://github.com/dpolishuk/bb-zcode.git@main
alia plugin search zcode
alia plugin install zcode@alia-zcode
```

Choose either the HTTPS catalog or Git source; they identify the same
`alia-zcode` marketplace and should not be added as separate catalogs.

## Why the repository page URL does not work

VesnALIA 0.46.1 interprets every plain `https://` marketplace source as a JSON
document. A GitHub repository page returns page data rather than a marketplace
manifest, so the plain repository URL is not accepted. This is VesnALIA's source
parser behavior and cannot be changed
by files in this repository. Use the raw JSON address or `git:` form above.

This differs from direct plugin installation, where VesnALIA accepts a GitHub page
URL without a prefix:

```sh
alia plugin install https://github.com/dpolishuk/bb-zcode
```

## Updates

Both catalog and plugin track `main`. A catalog refresh only updates listing
metadata; installing or updating the plugin is a separate native action.

```sh
alia marketplace refresh alia-zcode
alia plugin outdated
alia plugin update zcode
alia plugin source zcode
```

VesnALIA records the installed commit, checks engine compatibility, and builds the
plugin through its normal pipeline. A tagged release strategy can be adopted
later; this experimental catalog currently follows the main branch.

## Maintaining the catalog

Edit `PLUGIN_OVERVIEW.md` for the long description and `package.json` for the
plugin branding. Then run:

```sh
npm run marketplace:build
npm run check
```

The generator uses VesnALIA's version 2 marketplace format with inline overview
Markdown. `marketplace:check` prevents the generated catalog from drifting
from its source files. The live VesnALIA add/install flow is the compatibility check
for the actual installed host; see the [validation record](validation.md).
