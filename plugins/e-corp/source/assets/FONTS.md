# Embedded Plex fonts

Source: Google Fonts CSS API, retrieved 2026-09-05 with a modern Chrome user agent:

```text
https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:ital,wght@0,400..700;1,400..700&family=IBM+Plex+Mono:wght@500&display=swap
```

IBM Plex is distributed under the SIL Open Font License; see [OFL.txt](OFL.txt), copied from [Google Fonts](https://github.com/google/fonts/blob/main/ofl/ibmplexsans/OFL.txt). Existing Mono 400 assets are unchanged.

| Local asset | Original download |
|---|---|
| `mono500-latinext.woff2` | [Google Fonts WOFF2](https://fonts.gstatic.com/s/ibmplexmono/v20/-F6qfjptAgt5VM-kVkqdyU8n3twJwl5FgsAXHNlYzg.woff2) |
| `mono500-latin.woff2` | [Google Fonts WOFF2](https://fonts.gstatic.com/s/ibmplexmono/v20/-F6qfjptAgt5VM-kVkqdyU8n3twJwlBFgsAXHNk.woff2) |
| `sans-italic-latinext.woff2` | [Google Fonts WOFF2](https://fonts.gstatic.com/s/ibmplexsans/v23/zYXxKVElMYYaJe8bpLHnCwDKhdTEG46kmUZQCX598fQbGYrYAKRjdNS7Iw.woff2) |
| `sans-italic-latin.woff2` | [Google Fonts WOFF2](https://fonts.gstatic.com/s/ibmplexsans/v23/zYXxKVElMYYaJe8bpLHnCwDKhdTEG46kmUZQCX598fQbGYTYAKRjdNQ.woff2) |
| `sans-latinext.woff2` | [Google Fonts WOFF2](https://fonts.gstatic.com/s/ibmplexsans/v23/zYXzKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1syxQKYbSB4ZhRNU.woff2) |
| `sans-latin.woff2` | [Google Fonts WOFF2](https://fonts.gstatic.com/s/ibmplexsans/v23/zYXzKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1syxeKYbSB4Zh.woff2) |

The Mono 500 files are unmodified downloads. The four Sans files preserve the downloaded Unicode coverage, hinting, and OpenType features, with the variable `wght` axis restricted from 100–700 to 400–700. This avoids carrying unused light weights and leaves room for true italic and bold faces under VesnALIA's stylesheet cap. No glyph subsetting or layout-feature removal is applied.

To reproduce a Sans asset, download its original above to a temporary file, then run this with FontTools 4.64.0 and Brotli 1.2.0 (the preparation versions). Regular theme builds use only Python's standard library and the prepared assets; they need no network or font tooling.

```python
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

font = TTFont("downloaded.woff2")
font = instantiateVariableFont(font, {"wght": (400, 700)}, inplace=True)
font.save("sans-latin.woff2")  # Use the matching asset name from the table.
```

CSS Unicode ranges follow the corresponding Google Fonts Latin and Latin Extended declarations in `build.py`. Sans normal/italic support 400–700; Mono normal supports 400 and 500. Other scripts and unsupported styles/weights use the browser's normal font fallback/matching behavior.
