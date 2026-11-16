---
name: try-it
description: Hand a running build to the person for testing on their phone with the try_it tool and get their verdict per check.
---

# Try It

Call `try_it` when a build is ready for the person. Publish first: a localhost URL is refused. Use `alia connect expose <port>` when VesnALIA Connect is available.

Give at most 7 checks, each a concrete action and what they should see. A skipped check means it was not tried, not that it works. Fix what failed, then call `try_it` again with only the checks that matter now.
