# alia-polza — плагин VesnALIA «Polza» (провайдер polza.ai)

Публичный плагин для [VesnALIA](https://getbb.app), который добавляет провайдер агентов **Polza**:
вход в polza.ai через OAuth PKCE, белый список моделей каталога Пользы в селекторе моделей VesnALIA,
баланс и лимит ключа в футере сайдбара и настройках, оценка расхода в рублях по треду.
Движок агента — Claude Code CLI через `@anthropic-ai/claude-agent-sdk`, направленный на
Anthropic-совместимый `/v1/messages` Пользы. Пакет: `alia-plugin-polza`, id плагина `polza`.
Репозиторий: https://github.com/polza-ai/bb-plugin-polza (релизы — теги `vX.Y.Z`, их читает `alia plugin install`).

Дизайн и принятые решения: `docs/DESIGN.md`. Бридж в `src/` — форк встроенного провайдера
`provider-claude-code` из репозитория VesnALIA (MIT, `LICENSE.alia-upstream`); наши правки помечены
комментариями `// polza:`. Исходник апстрима для сравнения: `git clone --depth 1 https://github.com/get-bb/bb`
→ `plugins/provider-claude-code`.

## Стек и команды
- TypeScript, ESM, zod 4, React 19 (frontend шимится VesnALIA), vitest.
- `npm install` → сборка → `alia plugin install . --yes`. `alia plugin build` из обёртки `~/.vesnalia/npm` падает
  («Cannot find module 'npm/package.json'»): собирать бинарём приложения без переопределения `ALIA_CLI`:
  `env -u ALIA_CLI /Applications/alia.app/Contents/Resources/app.asar.unpacked/node_modules/alia-app/host-daemon/dist/alia plugin build .`
- `alia plugin dev` — пересборка и reload при изменениях; `alia plugin logs polza` — лог сервера плагина.
- `npx vitest run` — тесты.
- API Пользы: база `https://polza.ai/api`; `/v1/models` без ключа, `/v2/balance`, `/v1/key`,
  `/api/auth/authorize|token|userinfo` (PKCE, без client_id; результат — бессрочный ключ `pza_`).
