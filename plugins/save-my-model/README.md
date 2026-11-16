# Save My Model

Save My Model gives every machine enrolled in VesnALIA its own provider, model, and
reasoning preference. Open the plugin settings, select a connected or
disconnected machine, and configure it with VesnALIA's native provider/model picker.
The picker resolves the live catalog through that machine; supported changes
are stored in browser localStorage with host/provider-scoped keys.

The machine list comes directly from VesnALIA. The plugin does not maintain another
host registry or transport. Malformed and obsolete stored values are ignored or
reconciled against the selected machine's supported catalog, and provider
changes never reuse another provider's model or reasoning value.

This package preserves the storage behavior proposed in [VesnALIA PR #1964](https://github.com/get-bb/bb/pull/1964).
Because VesnALIA does not expose a supported hook for changing its built-in New
Thread defaults, the plugin does not override that composer. Preferences are
configured, restored, reviewed, and cleared from Save My Model's settings.

Requires VesnALIA 0.41 or newer and Plugin SDK 0.4.46 or newer. Release builds use
the first published compatible SDK, 0.4.47. It needs no external
service or account beyond the providers already configured on each VesnALIA machine.

Install from this monorepo:

```sh
alia plugin install git:https://github.com/MateoCerquetella/bb-plugins.git@^0.1.3 --subdirectory plugins/save-my-model --tag-prefix save-my-model/
```

Or install the community listing after it is merged:

```sh
alia plugin install save-my-model
```
