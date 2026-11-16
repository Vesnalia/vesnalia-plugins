# GitHub Copilot Usage for VesnALIA

Adds GitHub Copilot AI-credit or premium-request usage to VesnALIA's Provider Usage panel.

## Requirements

- VesnALIA 0.43 or newer.
- GitHub Copilot CLI installed and authenticated (`copilot login`).
- `tmux`, which provides the terminal emulation required by Copilot's interactive `/usage` display.

The plugin launches the local authenticated CLI, reads its visible `/usage` screen, and closes the temporary terminal session. It does not read or store Copilot credentials.

## Install

```sh
alia plugin install git:https://github.com/defacid/bb-copilot-usage.git
```
