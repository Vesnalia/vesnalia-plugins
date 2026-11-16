# alia-plugin-ui-scale

Scales the VesnALIA UI on one device. Use it to make VesnALIA bigger on desktop or
smaller on mobile.

- Open **Settings → UI Scale** on the device you want to change.
- Set the scale from 50% to 200%.
- The value is stored in the browser's `localStorage`. It is not synced.

The plugin sets the root font size. The VesnALIA app sizes text and spacing in
`rem`, so the full layout scales. Elements sized in `px` do not scale.

## Install

```sh
alia plugin install git:https://github.com/m9tdev/bb-plugin-ui-scale.git@^0.1.0
```

On iOS, the plugin adds `maximum-scale=1` to the viewport tag. This stops
Safari from zooming in when you tap a small text field. Pinch-to-zoom still
works on iOS. Other platforms are not changed.
