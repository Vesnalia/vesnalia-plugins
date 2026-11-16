---
type: Contract
title: Декларация провайдера (alia.providers.register)
description: Контракт регистрации агент-провайдера в VesnALIA — capabilities, модели, env, extension kinds и их пределы.
status: stable
stale_after: 2027-01-20T00:00:00Z
tags: [VesnALIA, provider, contract]
generated: { by: kimi-code/k3, at: "2026-10-20T10:52:46Z" }
verified: { by: kimi-code/k3, at: "2026-10-20T10:52:46Z" }
sources:
  - id: provider-api
    resource: https://github.com/get-bb/bb/blob/e0f6fda5a02332bd4eb44183542a57f34f3263d7/docs/provider-plugin-api.md
    title: Provider plugin API
    author: team:get-alia
  - id: providers-ref
    resource: https://github.com/get-bb/bb/blob/e0f6fda5a02332bd4eb44183542a57f34f3263d7/plugins/bb-guide/skills/bb-plugin-authoring/references/providers.md
    title: alia-plugin-authoring — Agent provider API
    author: team:get-alia
---

# Контракт

Плагин регистрирует провайдеров через `alia.providers.register({...})` в `alia.server`. Один плагин может владеть несколькими провайдерами (пример: ACP-плагин владеет Cursor и пользовательскими агентами).[^provider-api]

# Инварианты

- **Ids плоские, без резерваций.** Первая живущая регистрация id выигрывает; повтор из другого плагина валит загрузку того плагина. Отключение плагина убирает провайдера; открытые треды показывают provider-unavailable, а не ошибку.[^provider-api]
- **Декларация ↔ bridge не расходятся.** Capability объявляется *или* репортится, не оба; handshake моста может только сузить декларацию, не расширить.[^provider-api]
- **Capabilities проецируются в один клиентский тип** `ProviderInfo`.[^provider-api]
- **Презентация едет на `item.open`/`item.close` и персистится с айтемом** — строка таймлайна рендерится после удаления/обновления плагина. Иконка — имя глифа (`"FileText"` или `"<pluginId>/<name>"` из `alia.branding.experimental_icons`), никогда байты/путь.[^provider-api]

# Ключевые поля

| Поле | Назначение |
|---|---|
| `id`, `displayName`, `icon`, `family` | идентичность в пикере; id персистится в строках треда |
| `strings` | copy для core-поверхностей: sign-in hint, expiry hint, install URL, brand prefix, plan-mode copy, icon tint |

`icon` (логотип провайдера из `alia.branding.icon`) рендерится как
**currentColor-маска** («Provider logo assets use a currentColor mask» —
`PluginProviderIconRegistration` в SDK): выживает только альфа-силуэт,
залитый цветом текста. Отсюда правила: SVG строго одноцветный, смысл несут
вырезы в силуэте (evenodd), многоцветность — только через React-слот
`experimental_Icon` в app.tsx; цвет силуэта можно перекрыть per-theme через
`strings.iconTint { light, dark }`. Маркетплейс маскирует SVG так же — для
витрины многоцветную иконку вендорим в PNG/WebP. Проверено 2026-10-23 на
icons/kimi.svg: многоцветный тайл схлопывался в пустой квадрат в пилюле
композера; пин — `icon.test.ts` (одна краска + evenodd).
| `capabilities` | pre-session факты: `permissionModes` (закрытый enum), `fork` (`none`/`tip`/`checkpoint`), compaction, archive, rename |
| `maintenance` | какие sessionless `provider/*` методы поддерживает bridge (`health`, `usage`, `installation`); каждый по умолчанию `false` |
| `models` | `{ fallback, scope }`: `fallback` — холодный кэш до первой пробы `model/list`; `scope` (`host`/`workspace`) — как далеко распространяется ответ |
| `env.passthrough` | единственные переменные окружения демона, которые bridge может прочитать; остальные `ALIA_*` срезаются |
| `deriveProviderOptions(ctx)` | синхронно на каждой команде сессии/turn; результат (JSON ≤ 64 КиБ) доезжает до bridge как `options.providerOptions`; core его не читает |
| `extensionKinds` | свои виды айтемов/состояний `"<pluginId>/<name>"` со zod-схемами; сервер валидирует при ingest, сбой → `provider/unhandled` |

# Настройки и экспериментальные поля

- Пользовательские ручки провайдера — в `alia.settings.define` плагина, доезжают через `deriveProviderOptions`.[^providers-ref]
- `experimental_bridgeOptions` — только неизменяемые launch-факты (валидируется и замораживается при регистрации, участвует в идентичности процесса bridge). Не для настроек пользователя.[^provider-api]
- Экспериментальные поля носят префикс `experimental_` и могут меняться между релизами SDK.

# Порядок в пикере

Порядок провайдеров и провайдер по умолчанию — пользовательские настройки (`alia settings general providerOrder`, `defaultProviderId`); начальный порядок — порядок установки плагинов, bundled first-party первыми.[^provider-api]

# Связанные документы

- [Протокол provider bridge](/contracts/provider-bridge-protocol.md)
- [Поверхности alia-плагина](/architecture/alia-plugin-surfaces.md)

[^provider-api]: Provider plugin API
[^providers-ref]: alia-plugin-authoring — Agent provider API
