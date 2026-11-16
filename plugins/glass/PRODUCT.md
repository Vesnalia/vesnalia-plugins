# Transparency

Transparency lets VesnALIA users adjust the app’s visual atmosphere while keeping reading and writing comfortable. It combines global surface translucency, shader or image backdrops, and optional frost on navigation, composers, and popups. Below a 768px viewport, host surfaces remain opaque and the global backdrop is hidden so text from stacked panels cannot bleed through.

The main task is to explore a look in the labeled sample workspace, tune readability, and enable it across VesnALIA. The preview switches between Workspace and Backdrop. The effect is disabled by default; users can explore and save preferences while it is off. Six built-in shader thumbnails—Flow, Aurora, Nebula, Waves, Silk, and Contours—sit alongside Glow, Image, and Plain choices. The Look, Surfaces, Motion, and Shader inspector groups palette, opacity, frost, motion, rendering quality, and custom shader controls.

Custom shaders live in a local library of up to eight entries. Users can start from an example, edit GLSL ES 1.00, import a local .glsl/.frag file or Transparency JSON export, and export code as JSON. Drafts require an explicit successful preview of the unchanged source before Save & use becomes available. Drafts stay in the sample preview until saved; compiler errors appear in the editor. The renderer supplies time, resolution, a fixed zero mouse input, and three palette colors; external textures, includes, JavaScript, and remote shader imports are unsupported.

Every saved preference remains available when the effect is switched off. Reset requires inline confirmation, clears the wallpaper and appearance settings, and turns the effect off while retaining saved shaders. Removing a shader has its own confirmation. Pending appearance edits survive failed saves and can be retried; saved changes sync across open windows.

The configuration panel follows VesnALIA’s native settings language and light/dark tokens. The host owns its title, navigation, and app panel. This plugin supplies the studio body and a cleanup-safe global content script. The inspector stacks beneath the preview at narrow container widths. Custom wallpaper uses a validated HTTP or HTTPS URL with an explicit Apply image action and image-load feedback.

Ambient rendering honors reduced motion, pauses when hidden, and offers bounded Light, Balanced, and Detailed quality settings. Static shader thumbnails use the same renderer as the live artwork. Graphics failures fall back to a still backdrop and report recovery information in the preview.
