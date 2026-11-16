## What you get

A sidebar of parallel threads reads like this:

```
feat: csv export
fix: login redirect loop
review: rate limiter changes
ops: staging deploy pipeline
```

The category is one word for the kind of work. The name is two or three words about the subject of the task, in the language the task is written in. Everything is lowercase. The default categories are feat, fix, refactor, review, docs, research, ops and agents, each with a short description of the work it covers.

## Your own categories

The plugin's settings page has two fields. **Categories** takes one category per line as `name: what it covers`, from 1 to 16 of them. **Example names** takes up to 12 sample titles that show the model the style; an example whose category is not in your list is left out. VesnALIA refuses a value that breaks the format and says what is wrong. The same fields can be set from a terminal with `alia plugin config thread-names set categories "..."`.

## How it works

The plugin adds a thread-title service called Short thread names. After you select it with `alia settings ai-services set thread-title short-names --plugin thread-names`, it takes VesnALIA's title request, keeps the thread material (the task, later messages, agent replies, the current title), puts the naming rules and your categories on top, and sends it to VesnALIA cloud, the service that writes VesnALIA's default titles. The reply is lowercased before VesnALIA shows it.

When a first prompt is shorter than five words, VesnALIA keeps the prompt text as the title. After each finished turn, the plugin regenerates the title of any thread that is not yet in the `category: name` form, at most twice per thread. A thread that had the form and was then renamed by hand is left alone. A request that is not a title, such as a commit message, passes to VesnALIA cloud unchanged.

To go back to VesnALIA's own titles, run `alia settings ai-services set thread-title automatic`.

## Requirements

- VesnALIA 0.49 or later.
- A VesnALIA account signed in on this VesnALIA, with VesnALIA cloud on. Titles count against the VesnALIA cloud daily budget, and no API key is needed.
- Turning VesnALIA cloud off with `alia ai off` stops the service at once.
