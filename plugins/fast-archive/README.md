<img src="../../assets/plugin-icons/fast-archive.png" alt="" width="64" height="64" align="right">

# Fast Archive

[![Version](https://img.shields.io/badge/version-0.1.0-blue)](package.json)
[![VesnALIA](https://img.shields.io/badge/bb-0.43%2B-blue)](https://getbb.app)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Archive a thread from its header with one click. Uses VesnALIA’s ordinary archive action, so archived threads remain recoverable.

![Fast Archive in VesnALIA](../../marketplace/screenshots/fast-archive/overview.png)

*Real plugin interface with isolated demonstration data.*

## Install

From the collection root: `alia plugin install ./plugins/fast-archive`.

Requires VesnALIA 0.43+ and SDK 0.4.87+. Works on its own. If your VesnALIA already shows a native archive button in the same header, Fast Archive hides its duplicate.

## CLI

`alia fast-archive <thread-id>` archives a thread. Restore it through VesnALIA’s archived-thread controls. No files or provider sessions are deleted.

## Versioned release

```sh
alia plugin install 'git:https://github.com/dmitriikapustin/bb-plugins-by-kapustin.git@^0.1.0' --plugin fast-archive --tag-prefix fast-archive/
```

MIT · **Dmitrii Kapustin** · [All plugins](../../README.md)
