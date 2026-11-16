# Transparency

Make VesnALIA your own with translucent surfaces, six animated backdrops, custom GLSL shaders, and wallpaper. Preview your look, then adjust colors, opacity, frost, and motion in one panel.

Requires **VesnALIA 0.41.0 or later** and Plugin SDK **0.4.34 or later**.

## Install and enable

Install **Transparency** from [notpritam’s VesnALIA marketplace](https://github.com/notpritam/bb-marketplace), or install the public release directly:

```sh
alia plugin install 'git:https://github.com/notpritam/bb-plugin-glass.git@^0.2.0'
```

Open **Transparency** in VesnALIA’s sidebar or Settings and turn on **Enable transparency**. No account, API key, or subscription is needed. The effect starts off by default. Preferences save automatically and synchronize across open windows. Loading or saving failures show a retry action.

The version range lets VesnALIA offer compatible 0.2.x updates through its plugin management controls. You choose when to install them.

## Your backdrop studio

The panel uses the available width, with a sample workspace beside **Look**, **Surfaces**, **Motion**, and **Shader** controls. Compact screens keep VesnALIA's reading surfaces opaque so underlying panels cannot show through the main content; desktop opacity preferences are retained. The panel's shader preview still works on compact screens.

### Create or import a shader

1. Choose **Add shader**, or open the **Shader** tab. Start from the example or import a `.glsl`, `.frag`, or Transparency `.json` export.
2. Give it a name and edit `void mainImage(out vec4 color, in vec2 fragCoord)` using GLSL ES 1.00.
3. Select **Preview shader**. Compile errors appear beside the editor. Previewing does not change the global backdrop.
4. After a successful preview, select **Save & use**. Any code edit requires another preview. Enable transparency separately to apply the selected shader across VesnALIA.
5. Use **Edit**, **Remove**, or **Export code** to manage your library. Removing a selected shader returns the backdrop to Flow. Resetting appearance retains saved shaders.

Inputs are already declared: `iResolution` (vec3 canvas size), `iTime` (float seconds), `iMouse` (vec4 fixed at zero), and `uColorA`, `uColorB`, `uColorC` (vec3 palette colors). External textures/includes and JavaScript are not supported. The library holds eight shaders; source is limited to 16,384 characters and 24 KB. Imports are limited to 40 KB and exports use `{ "version": 1, "name": "…", "source": "…" }`. Shader source is kept in this installation's local plugin storage.

Six built-ins include **Silk** and **Contours** alongside Flow, Aurora, Nebula, and Waves. Choose VesnALIA's theme palette, Cobalt, Moss, Ember, Dusk, or three custom colors. Rendering quality caps frame rate and pixel count: Light (15 fps / 250k pixels), Balanced (24 fps / 600k), Detailed (30 fps / 1.2m). Hidden tabs pause, reduced motion produces a still frame, and unavailable/lost WebGL falls back to a CSS backdrop. Custom shaders depend on your browser's graphics support; no compilation or performance portability is promised across devices.

## Choose a backdrop

- **Flow, Aurora, Nebula, Waves, Silk, Contours:** ambient animated backgrounds. They use a still frame when motion is off or your device requests reduced motion.
- **Glow:** soft accent light from below.
- **Image:** paste a direct HTTP or HTTPS image URL, then select **Apply image**. The browser must be able to load the URL. Clear the field and apply to remove it. URLs with embedded credentials, local file paths, and data URLs are not accepted.
- **Plain:** a plain dark backdrop behind translucent surfaces.

Remote wallpapers load from their original website in each VesnALIA window. Wallpaper URLs are stored in this plugin’s local VesnALIA storage. The preview reports when an image cannot load; there is no upload or bundled wallpaper service.

Lower **Surface opacity** reveals more of the backdrop. Increase opacity or dimming when text becomes hard to read. **Backdrop blur** affects generated backgrounds; wallpapers stay sharp. **Motion speed** applies to the animated shader backdrops. Frost controls can be adjusted separately for the sidebar, chat input, and dialogs/popups.

**Reset settings…** asks for confirmation before restoring defaults, clearing the wallpaper URL, and switching transparency off. Switching the effect off preserves your preferences.

## Scope and limitations

Transparency changes the background inside VesnALIA; it cannot reveal the desktop through the native window. The effect is global to the VesnALIA installation, with one content-script instance per open window or remote browser. Reduced motion is respected immediately, and background animation pauses in hidden tabs. If WebGL is unavailable, animated backgrounds fall back to Glow.

Frost follows VesnALIA’s current sidebar, composer, and popup markup. Host layout changes may require a plugin update. Readability also depends on your theme, wallpaper, and chosen opacity. The plugin removes its styles, backdrop, listeners, timers, pending requests, and graphics resources when disabled or unloaded.

## Development

```sh
npm install
alia plugin types --check
npm run typecheck
npm test
npm run build
```

The exact development SDK is pinned in `package.json`; `alia plugin types` updates it to match the running VesnALIA. Tests use the official SDK backend and frontend harnesses for validation, concurrent writes, retry behavior, and content-script cleanup. Browser verification uses the actual component, installed VesnALIA stylesheet, and SDK harness; it does not substitute for checking host layout after a VesnALIA update.

For local development, build first, then explicitly install or reload the plugin:

```sh
alia plugin install .
alia plugin reload glass
```

For browser regression checks, start a separate VesnALIA instance with a new data directory and install this working copy there. Never point these tests at your normal VesnALIA server: they create/delete test shaders and change appearance settings.

```sh
GLASS_TEST_ALIA_URL=http://127.0.0.1:4335 npm run test:browser
GLASS_TEST_ALIA_URL=http://127.0.0.1:4335 npm run test:backdrop
```

The pixel regression verifies that different shaders change the real global backdrop and the VesnALIA reading surface, including WebGL loss/recovery. The browser smoke verifies compact surfaces at 320/390/600/767px, desktop restoration on resize, shader validation/import/preview/save/reset/removal, and captures light/dark desktop, phone, tablet, and the actual mobile shelves.

The **Transparency** panel is the configuration surface. Settings are stored under the existing `config` key; normal edits preserve unrelated stored fields.
