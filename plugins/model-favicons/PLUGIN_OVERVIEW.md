Give every agent its own logo, so custom ACP agents stop sharing the generic
Toolbox mark.

## What you get

- A real mark for the agents VesnALIA leaves on the Toolbox glyph — ZCode/GLM, Kimi Code,
  MiniMax Code and others draw their own logo in the model picker, the provider list
  and everywhere else VesnALIA draws a provider.
- Nine bundled marks, including the official ACP registry artwork, drawn as inline
  SVG that follows the VesnALIA theme in light and dark.
- A `alia model-favicons` command, so an agent can set a mark from a terminal:
  `alia model-favicons set acp-zcode glm`.
- A **Model Favicons** page in the left sidebar for setting and clearing marks by
  hand.

## How it works

VesnALIA draws one icon per provider — every model row inherits its provider's logo — so
this plugin registers a mark per provider id through VesnALIA's provider-icon slot. A
registered mark replaces the provider's own logo while keeping its theme tint.

The choices live in this plugin's own storage on the VesnALIA server, one map per
installation. Nothing leaves the machine, and the plugin needs no account, API key,
or external service.

## For agents

The bundled skill tells an agent to find the provider id with `alia provider list`,
set a mark with `alia model-favicons set`, and check the current state with
`alia model-favicons list`.
