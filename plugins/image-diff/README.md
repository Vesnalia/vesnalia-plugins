# alia-plugin-image-diff

Pixel diff of changed images in VesnALIA, modelled on IntelliJ's
[imgdiff](https://github.com/ehmkah/imgdiff): Before, Diff and After side by
side, with imgdiff's three modes.

- **White background** — unchanged pixels are white, changed pixels magenta.
- **Original background** — unchanged pixels keep the After image, changed pixels magenta.
- **Blinking** — changed pixels flash between magenta and the After image.

Plus Fit / 100% zoom, dimensions, and a changed-pixel count. Images of
different sizes are compared over the union of their sizes.

## How to use it

1. Open a thread whose environment is a Git checkout with a changed image
   (uncommitted, or committed on the branch).
2. An **Image diff** icon appears in the right panel's tab strip, next to
   Info and Diff. It is only there while the thread has changed images.
3. Pick **Uncommitted**, **Branch** or **All**, then the image from the list.

Opening a changed image directly (chat link, file picker, `alia thread open
path.png`) shows the same view instead of VesnALIA's preview. Unchanged images keep
VesnALIA's preview. Pin a different opener under Settings → File openers if you prefer.

**Git LFS images render inside VesnALIA's own Diff tab.** Git sees an LFS image as
a small pointer text file, so VesnALIA's Diff tab would show a text diff of two
`oid sha256:` lines; this plugin replaces that with the image diff in place.
Expand the file row and the images load, downloading missing LFS objects on
demand. Every other diff keeps VesnALIA's renderer. (Images not in LFS keep VesnALIA's own
Before/After preview in the Diff tab; use the Image diff tab for those.)

Supported: png, jpg, jpeg, gif, webp, bmp, ico, avif, svg. Git LFS needs
`git-lfs` installed on the host and non-interactive access to the LFS remote.

## How it works

Both sides are read through VesnALIA's bundled Git plugin (`alia--git` `files` and
`fileSide` RPC), decoded on a canvas, and compared with exact RGBA equality —
no tolerance, like imgdiff. The only server code is a host entry that resolves
an LFS object id with `git lfs smudge`.

```
npm test          # unit tests (node --test, no framework)
npm run typecheck
alia plugin build
alia plugin install .
```

Files: `app.tsx` (registrations and Git reads), `image-diff.tsx` (the view),
`pixel-diff.ts` (pure comparison), `lfs.ts` (pointer parsing), `git.ts` (the
slice of the Git RPC contract used), `contract.ts` + `server.ts` + `host.ts`
(LFS resolution).
