## What you get

- Every ```` ```mermaid ```` block in chat and in Markdown file previews renders with [agentic-mermaid](https://github.com/adewale/agentic-mermaid): boxes, participants, and group frames have visible outlines, and edges route around nodes at right angles.
- 15 diagram types: flowchart, state, sequence, class, ER, gantt, pie, mindmap, timeline, user journey, quadrant, XY chart, architecture, and radar.
- Git graphs, diagram types agentic-mermaid can't draw (such as sankey), and diagrams with syntax errors keep VesnALIA's own renderer, including its source view for broken diagrams.
- VesnALIA's block controls keep working: the source toggle, copy, and the full-screen pan and zoom view.

## Follows your theme

Diagram colors come from your active VesnALIA theme's text, accent, and surface colors. Switching between light and dark mode recolors diagrams already on screen.

## How it works

- VesnALIA has no plugin slot for Mermaid blocks, so the plugin swaps the render function of the Mermaid module VesnALIA already loads. Diagrams VesnALIA drew before the plugin loaded are redrawn in place.
- The plugin's own backend serves agentic-mermaid in per-diagram-type pieces. The browser downloads only the types a conversation uses, so VesnALIA's page load grows by about 6 KB.
- Rendering runs in agentic-mermaid's strict mode: no network requests, and labels are escaped.

## Requirements

- VesnALIA 0.43 or later.
- No account, API key, or external service.
- The plugin depends on VesnALIA internals that can change between VesnALIA releases. If a release changes them, the plugin does nothing and VesnALIA's stock renderer stays in place.
- Pie charts use agentic-mermaid's own blue palette rather than your theme's accent.
