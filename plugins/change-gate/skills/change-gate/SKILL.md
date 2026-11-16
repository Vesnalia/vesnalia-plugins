---
name: change-gate
description: Ask the person with the change_gate tool before changing production or shared data, and read past decisions with `alia change-gate log`.
---

# Change Gate

Call `change_gate` before a migration, a deploy, a server configuration change, or deleting shared data. Use plain words, and say honestly if the change cannot be undone. Never put a credential in the commands.

Only an approval allows the change, and it covers that one request. After a decline or no answer, do not look for another route to the same change.

The gate does not technically stop other tools. It relies on you asking first.
