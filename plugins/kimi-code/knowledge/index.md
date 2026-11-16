---
okf_version: "0.2"
---

# База знаний alia-kimi-code

Инженерные знания для разработки VesnALIA provider plugin (агент-харнесс) в этом репозитории. Правила использования корпуса — в корневом [AGENTS.md](../AGENTS.md), раздел «Использование базы знаний».

# Состояние проекта

* [Состояние репозитория alia-kimi-code](project-state.md) — что реально лежит в репозитории: provider plugin `alia-plugin-kimi-code` v0.1.0, статус проверок, открытые вопросы.

# Решения

* [ACP вместо собственного bridge](decisions/acp-over-custom-bridge.md) — Kimi Code подключается через готовый ACP-кит VesnALIA; основания из живого handshake `kimi acp`.
* [Upstream PR-план: расширение Kimi Code](roadmap/2026-10-24-kimi-code-upstream-prs.md) — семь аккуратных PR в MoonshotAI/kimi-code (typed occupancy, usage --json, plan-шаги, swarm-прогресс, secondary model, video, fork handoff) с файлами, размерами и порядком; карта исходников acp-server/agent-core-v2.

# Архитектура

* [Поверхности alia-плагина](architecture/alia-plugin-surfaces.md) — из чего состоит плагин (server/host/app/skills), где выполняется каждая часть, модель доверия и доставки.

# Контракты

* [Декларация провайдера](contracts/provider-declaration.md) — контракт `alia.providers.register`: capabilities, модели, env, extension kinds.
* [Протокол provider bridge](contracts/provider-bridge-protocol.md) — инварианты JSON-RPC моста: грамматика дельт v3, жизненный цикл turn/item, recovery hints.
* [Provider usage panel](contracts/provider-usage-panel.md) — отличие `provider/usage` от федеративного `provider-usage.v1`, поток через enrolled hosts и lifecycle кэша.

# Ранбуки

* [Проверка изменений плагина](runbooks/verify-plugin-change.md) — как проверять изменения: TDD-цикл, conformance kit, record/replay, команды `alia plugin`.

# Инциденты

* [Shadowing бинаря kimi: «Thinking On» вместо уровней](incidents/2026-10-20-shadowed-kimi-binary.md) — VesnALIA daemon запускал старый kimi-cli 0.23.5 из Homebrew вместо Kimi Code 2.x; диагностика через alia.db и пробы.
* [kimi 2.3.0 сломал fork: session lock запрещает кросс-процессный fork живой сессии](incidents/2026-10-22-kimi-23-session-lock-breaks-fork.md) — эксклюзивный лок сессии на процесс против модели fork'а VesnALIA новым процессом; декларация сужена до `fork: "none"`, исход правила запинован в live-тесте. С 2.3.1 есть выключатель `KIMI_CODE_SESSION_LOCK=0` (fork с ним работает) — оставлен выключенным из-за риска torn-копии, см. аддендум.
* [Permission mode auto отклоняется ACP-мостом](incidents/2026-10-23-acp-bridge-rejects-auto-mode.md) — SDK acp-next бросает на alia-режиме `auto`, а декларация его обещала; сужено до `["accept-edits", "full"]` по прецеденту встроенных ACP-провайдеров VesnALIA.
* [Исчерпание квоты Kimi — пустые turn'ы](incidents/2026-11-01-kimi-quota-silent-turns.md) — acp-server отвечает на 429 пустым `end_turn` без update'ов, VesnALIA показывает бессмысленный warning; fix v0.2.15: quota gate на turn/start с типизированным `rateLimited` и временем сброса.
