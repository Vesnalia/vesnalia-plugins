---
type: Architecture
title: Поверхности alia-плагина
description: Из чего состоит alia-плагин (server/host/app/skills), где выполняется каждая часть и как артефакты доставляются на хосты.
status: stable
stale_after: 2027-01-20T00:00:00Z
tags: [VesnALIA, plugin, architecture]
generated: { by: kimi-code/k3, at: "2026-10-20T10:52:46Z" }
verified: { by: kimi-code/k3, at: "2026-10-20T10:52:46Z" }
sources:
  - id: quickstart
    resource: https://github.com/get-bb/bb/blob/e0f6fda5a02332bd4eb44183542a57f34f3263d7/plugins/bb-guide/skills/bb-plugin-authoring/references/quickstart.md
    title: alia-plugin-authoring — Plugin quickstart
    author: team:get-alia
  - id: provider-api
    resource: https://github.com/get-bb/bb/blob/e0f6fda5a02332bd4eb44183542a57f34f3263d7/docs/provider-plugin-api.md
    title: Provider plugin API
    author: team:get-alia
---

# Поверхности плагина

Плагин — TypeScript-пакет; манифестом служит `package.json` с блоком `alia`.[^quickstart]

| Поле манифеста | Обязательность | Где выполняется | Назначение |
|---|---|---|---|
| `alia.server` | обязательно | сервер VesnALIA | `alia.providers.register`, настройки (`alia.settings.define`), CLI, agent tools |
| `alia.host` | опционально | host-демон на машине | full-trust Node 22 ESM: host RPC и provider bridge |
| `alia.app` | опционально | фронтенд (веб/десктоп) | `definePluginApp`: UI-слоты, renderer'ы, иконки провайдера |
| `alia.skills` | опционально (по умолчанию `skills/`) | подмешивается в треды агентов | `skills/<name>/SKILL.md` как plugin skills tier |

Plugin id = финальный компонент имени пакета минус префикс `alia-plugin-`; id неймспейсит роуты, storage, настройки и CLI.[^quickstart]

# Доставка и доверие

- `alia plugin build` эмитит `dist/server.js`, `dist/app.js`/`app.css`, `dist/host.js` с `*.meta.json` (штампы `sdkMajor`, `pluginId`, `pluginVersion`).[^quickstart]
- Host-артефакты контент-адресуемы: сервер собирает `dist/host.js` и записывает digest; демон скачивает байты, проверяет digest **до** кэширования и запускает своим node.[^provider-api]
- Модель доверия — установочная: bridge/host-код запускается только для установленного и включённого плагина.[^provider-api]
- Path-инсталлы грузят `alia.server` как TypeScript напрямую; managed-инсталлы (git/npm) используют собранный бандл при совпадении SDK major.[^quickstart]

# Правило импортов

Плагину разрешены только `@vesnalia/plugin-sdk` (включая subpaths `/provider-bridge`, `/host`, `/app`, `/testing`, `/provider-bridge/testing`), npm-пакеты, node builtins и свои файлы. Приватные `@alia-core/*` workspace-пакеты не резолвятся в установленном плагине — запрещены везде, включая тесты.[^provider-api]

# Связанные документы

- [Декларация провайдера](/contracts/provider-declaration.md)
- [Протокол provider bridge](/contracts/provider-bridge-protocol.md)
- [Проверка изменений плагина](/runbooks/verify-plugin-change.md)

[^quickstart]: alia-plugin-authoring — Plugin quickstart
[^provider-api]: Provider plugin API
