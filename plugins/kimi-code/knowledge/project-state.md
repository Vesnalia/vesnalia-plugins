---
type: Project State
title: Состояние репозитория alia-kimi-code
description: Репозиторий — VesnALIA provider plugin `alia-plugin-kimi-code` для Kimi Code CLI через acp-next bridge с kimi-диалектом; тесты и сборка зелёные, git инициализирован.
status: stable
tags: [project, state]
generated: { by: kimi-code/k3, at: "2026-10-20T12:11:59Z" }
verified: { by: zcode, at: "2026-10-22T19:40:00Z" }
sources:
  - id: repo-ls
    resource: /Users/dpolishuk/work/alia-kimi-code
    title: Наблюдение файловой системы и прогоны тестов/сборки 2026-10-20
    author: kimi-code/k3
  - id: live-2022
    resource: Локальные прогоны `ALIA_KIMI_LIVE=1 npx vitest run kimi-live.*`, 2026-10-22
    title: Live-проверки против kimi acp 2.3.0 — conformance все правила, кроме запинованного session/fork-identity; session state, maintenance, models, tools
    author: zcode
---

# Наблюдаемые факты (проверены 2026-10-22)

- Репозиторий — VesnALIA provider plugin `alia-plugin-kimi-code` v0.1.0: `server.ts`
  (декларация), `host.ts` (acp-next bridge + регистрация диалекта),
  `src/dialect.ts`, `src/kimi-account.ts`, `icons/kimi.svg`,
  `skills/kimi-code/SKILL.md`, тесты (юнит + live gated `ALIA_KIMI_LIVE=1`).
  Покрытие возможностей: [решение об ACP](/decisions/acp-over-custom-bridge.md).[^repo-ls]
- Bridge — `@vesnalia/plugin-sdk/provider-bridge/acp-next` (см. риск deprecated
  alias в `host.ts` и в решении).[^repo-ls]
- Проверки зелёные (2026-10-22, kimi CLI 2.3.0): `vitest run` — 23/23 юнит;
  `tsc --noEmit` чист; `alia plugin build` собирает `dist/server.js` +
  `dist/host.js` (SDK 0.6.49, VesnALIA 0.46.1). Live: conformance — все правила;
  `session/fork-identity` kit исключает сам из-за суженного до `none`
  handshake ([инцидент](/incidents/2026-10-22-kimi-23-session-lock-breaks-fork.md),
  session lock kimi 2.3.0); session-state, maintenance (health ready, без
  пина точной версии), models, tools.[^live-2022]
- `fork: "none"` в декларации и в bridge handshake с 2026-10-22 (обёртка
  `narrowInitializeForkOnBridge` в `host.ts`, SDK хардкодит `"tip"`): kimi
  ≥ 2.3.0 запрещает кросс-процессный fork живой сессии; подробности — в
  [инциденте](/incidents/2026-10-22-kimi-23-session-lock-breaks-fork.md).[^live-2022]
- Git инициализирован 2026-10-20; работа коммитится поэтапно.[^repo-ls]
- Релиз **v0.2.0** (2026-10-23, tag на `b2dd99e`): fork `none` в декларации
  и handshake, knowledge по swarm/secondary model. Каталог `marketplace.json`
  поднят до `^0.2.0` — под semver caret-диапазон с базой 0.x минорные релизы
  не попадают (`^0.1.0` ≠ 0.2.0), правило зафиксировано в
  [docs/marketplace.md](../docs/marketplace.md). Плагин установлен в живой VesnALIA
  из маркетплейса: `kimi-code@0.2.0 running`, source
  `git:…@semver:^0.2.0`, `alia provider models kimi-code` отдаёт каталог.[^live-2022]
- `.npmrc` разрешает install-скрипты `better-sqlite3`, `node-pty`,
  `@parcel/watcher` — иначе npm блокирует сборку нативных аддонов alia-app.
- `.serena/` — стандартная конфигурация Serena; содержимое
  `project.local.yml` не инспектировалось.

# Harness-окружение (вне OKF bundle)

Работа ведётся из Kimi Code CLI; наборы скиллов лежат на уровне пользователя
(`~/.kimi-code/skills`, `~/.agents/skills`), а не в репозитории. Инструкции
harness живут в корневом [AGENTS.md](../AGENTS.md) и вне этого bundle.

# Открытые вопросы

- Установка в живой VesnALIA проверена end-to-end 2026-10-23 через маркетплейс
  (remove старой `^0.1.0`-установки → `alia plugin install kimi-code` по
  каталогу `^0.2.0`); enrolled-хост по-прежнему не проверялся.
- SDK: обновлено 0.6.49 → 0.6.73 (v0.2.8), затем 0.6.90 (v0.2.10,
  2026-10-27). 0.6.90 уже содержит наш PR get-alia/alia#6180
  (`additionalSessionDirectories` в acp-next) — `additionalDirectories`
  пробрасывается агенту, gap закрыт. `/acp` и `/acp-next` всё ещё раздельные,
  `fork: "tip"` хардкодится, throw на `auto` на месте — обёртка fork в
  `host.ts` нужна по-прежнему. Перепроверять слияние entrypoints при
  следующих апгрейдах SDK.
- Кандидаты в upstream-issue (не заведены): (1) MoonshotAI/kimi-code —
  session lock ломает ACP `session/fork` живой сессии из другого процесса;
  (2) get-alia/plugin-sdk — initialize моста заявляет `fork: "tip"` без
  проверки агента, без диалектного хука сузить (плагин обходит обёрткой в
  `host.ts`; кандидат в issue остаётся).

[^repo-ls]: Наблюдение файловой системы и прогоны тестов/сборки 2026-10-20
[^live-2022]: Live-прогоны против kimi acp 2.3.0, 2026-10-22
