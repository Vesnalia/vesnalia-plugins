# Change Gate

Agents ask before changing production: what changes, where, and how to undo it. You answer in one click, and every decision goes into a journal (`bb change-gate log`).

The gate is an agreement, not a lock: agents are instructed to call it, but it cannot block other tools. Use it with the permission rules of your provider, not instead of them.

An agent with shell access could answer its own request through `bb thread interactions respond`, so treat the journal as a record of what was asked and answered, not as proof a person clicked.
