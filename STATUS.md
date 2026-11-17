# Состояние плагинов

Проверка: копия плагина, `npm install --omit=dev --ignore-scripts` и сборка app/server/host сборщиком alia-core (`packages/plugin-build`), как сервер делает при установке из git. Скрипт - `scripts/verify.mjs`, сырые результаты - `data/verify.json`, полная таблица - `status.json`.

Всего 576: собирается 523, соберётся после публикации `@vesnalia/plugin-sdk` в npm 49, сломано 4.

«После публикации SDK» - плагину нужен установленный SDK (сабпути вроде `/provider-bridge`, `/process`, `/host` в серверном или host-коде, корень SDK во фронтенде). Сервер ставит зависимости git-плагина через `npm install`, а `@vesnalia/plugin-sdk` в npm пока нет. Проверка с пакетом SDK из alia-core (`npm pack`) такие плагины собирает. Предупреждения о снятых API SDK - в `status.json` (`warnings`).

Колонка «Остатки bb» - число строк кода, где ещё встречается имя bb (не ссылки); обычно это имена внешних сервисов или текст, который кодмод не тронул намеренно.

| Плагин | Собирается | app / server / host | Что поправлено | Что сломано | Остатки bb |
| --- | --- | --- | --- | --- | --- |
| account-pool-balanced | да | ok / ok / ok | - | - | - |
| acp-profile-icons | да | ok / ok / - | - | - | - |
| action-topbar | да | ok / ok / - | переименовано файлов с bb в имени: 2 | - | - |
| advisor | да | ok / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| agent-board | да | ok / ok / - | переименовано файлов с bb в имени: 2 | - | - |
| agent-calendar | да | ok / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| agent-checklists | да | ok / ok / - | - | - | - |
| agent-graph | да | ok / ok / - | - | - | - |
| agent-icons | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| agent-lanes | да | ok / ok / - | переименовано файлов с bb в имени: 1 | - | - |
| agent-plugins | да | ok / ok / ok | - | - | - |
| agent-proxy | да | ok / ok / - | - | - | - |
| agent-reload | да | ok / ok / - | - | - | - |
| agent-retry | да | - / ok / - | - | - | - |
| agent-roles | да | ok / ok / - | - | - | - |
| agent-tools | да | ok / ok / ok | - | - | - |
| agent-traces | да | ok / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| agent-tv | да | ok / ok / - | - | - | - |
| agentic-mermaid | да | ok / ok / - | - | - | - |
| aif-chat | да | ok / ok / ok | - | - | - |
| airbender | да | ok / ok / - | - | - | - |
| alium | да | ok / ok / - | - | - | - |
| android-emulator | да | ok / ok / ok | - | - | - |
| animation | да | ok / ok / - | - | - | - |
| antigravity | да | ok / ok / - | - | - | - |
| antigravity-cli | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| antigravity-usage | да | - / ok / ok | имя пакета alia-antigravity-usage даёт id "alia-antigravity-usage", переименовано в alia-plugin-bb-antigravity-usage | - | - |
| app-preview | да | ok / ok / - | - | - | - |
| arc-switcher | да | ok / ok / - | engines.bbPluginSdk ^0.4.1 -> engines.aliaPluginSdk >=0.6 (SDK 0.6.143); переименовано файлов с bb в имени: 2 | - | - |
| archive-section | да | - / ok / - | - | - | - |
| archived-toggle | да | ok / ok / - | - | - | - |
| artifacts | да | ok / ok / - | - | - | - |
| asana | да | ok / ok / - | - | - | - |
| asciimoji | да | ok / ok / - | - | - | - |
| attention-sidebar | да | ok / ok / - | - | - | - |
| audio-preview | да | ok / ok / - | - | - | - |
| auggie | да | ok / ok / - | - | - | - |
| aura | да | ok / ok / - | - | - | - |
| aura-motion | да | ok / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| auto-answer | да | ok / ok / - | - | - | - |
| auto-compact | да | ok / ok / - | - | - | - |
| auto-hide-panel | да | ok / ok / - | - | - | - |
| auto-pin | да | - / ok / - | - | - | - |
| auto-router | после публикации SDK | - / - / - | engines.bb >=0.46.0 <0.47.0 -> engines.alia >=0.49 (alia-core 0.49.0); SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| automation-groups | да | ok / ok / - | - | - | - |
| automation-palette | да | ok / ok / - | - | - | 4 |
| autoresearch | да | ok / ok / ok | имя пакета alia-autoresearch даёт id "alia-autoresearch", переименовано в alia-plugin-bb-autoresearch; переименовано файлов с bb в имени: 1 | - | 6 |
| autoresearch-self-loop | да | ok / ok / - | - | - | - |
| autorouter | да | ok / ok / - | - | - | - |
| aws-activate-usage | да | ok / ok / - | - | - | - |
| ayu | да | ok / ok / - | - | - | - |
| backlog | да | ok / ok / ok | engines.bbPluginSdk ^0.5.9 -> engines.aliaPluginSdk >=0.6 (SDK 0.6.143); переименовано файлов с bb в имени: 2 | - | - |
| ballast | да | ok / ok / - | - | - | - |
| bang-shell | да | ok / ok / - | - | - | - |
| battery | да | ok / ok / - | - | - | - |
| beacon | да | ok / ok / - | - | - | - |
| beads | да | - / ok / ok | - | - | - |
| beautiful-chat | да | ok / ok / - | - | - | - |
| beside | да | ok / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| better-latex | да | ok / ok / - | имя пакета alia-better-latex даёт id "alia-better-latex", переименовано в alia-plugin-bb-better-latex | - | - |
| boat | да | - / ok / - | - | - | - |
| bookmarks | да | ok / ok / - | - | - | - |
| bots | да | ok / ok / - | - | - | - |
| bots-sidebar | да | ok / ok / - | - | - | - |
| branch-graph | да | ok / ok / ok | - | - | - |
| breathe | да | ok / ok / - | - | - | - |
| browser-annotate | да | ok / ok / ok | - | - | - |
| browser-copy | да | ok / ok / ok | - | - | - |
| browser-gestures | да | ok / ok / - | - | - | - |
| browser-session-import | да | ok / ok / ok | - | - | - |
| browser-tools | да | - / ok / ok | - | - | - |
| browserbase | да | - / ok / - | - | - | - |
| btrfs-cow | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| bureaucat | да | ok / ok / ok | - | - | - |
| burn | да | ok / ok / ok | переименовано файлов с bb в имени: 5 | - | - |
| cache-watch | да | ok / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| callstack | да | ok / ok / - | - | - | - |
| calm | да | ok / ok / - | переименовано файлов с bb в имени: 1 | - | - |
| canvas | да | ok / ok / - | - | - | - |
| captains-deck | да | ok / ok / - | - | - | - |
| career-hub | да | ok / ok / - | - | - | - |
| cascade | да | ok / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| catchup | да | ok / ok / - | - | - | - |
| change-gate | да | ok / ok / - | - | - | - |
| chat-dock | да | ok / ok / - | - | - | - |
| chat-find | да | ok / ok / - | - | - | - |
| chat-search | да | ok / ok / - | - | - | - |
| chat-sidebar | да | ok / ok / - | - | - | - |
| chat-width | да | ok / ok / - | engines.bb >=0.47.1 <0.48.0 -> engines.alia >=0.49 (alia-core 0.49.0); убрана зависимость bb-app (devDependencies) | - | - |
| chatgpt-skin | да | - / ok / - | переименовано файлов с bb в имени: 1 | - | - |
| chief | да | ok / ok / - | - | - | - |
| chime | да | ok / ok / - | - | - | - |
| claude-account-switcher | да | ok / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| claude-accounts | да | ok / ok / ok | - | - | - |
| claude-auth | да | ok / ok / - | - | - | - |
| claude-switcher | да | ok / ok / - | переименовано файлов с bb в имени: 2 | - | - |
| claude-theme | да | - / ok / - | - | - | - |
| claude-usage | да | ok / ok / - | - | - | - |
| cli-agents | да | ok / ok / ok | - | - | - |
| clickable-local-link | да | ok / ok / - | - | - | - |
| close-tab | да | ok / ok / - | - | - | - |
| cloud-sandbox | да | ok / ok / - | - | - | - |
| code-review | да | ok / ok / - | - | - | - |
| code-review-workspace | да | ok / ok / - | - | - | - |
| codex-migrate | да | ok / ok / - | engines.bb >=0.44 <0.45 -> engines.alia >=0.49 (alia-core 0.49.0); переименовано файлов с bb в имени: 2 | - | - |
| codex-realtime | да | - / ok / - | - | - | - |
| codex-theme | да | ok / ok / - | переименовано файлов с bb в имени: 3 | - | - |
| collapsible-navigation | да | ok / ok / - | - | - | - |
| color-swatches | да | ok / ok / - | engines.bbPluginSdk ^0.4.1 -> engines.aliaPluginSdk >=0.6 (SDK 0.6.143) | - | - |
| command-center | да | ok / ok / - | - | - | - |
| command-code | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| compact-nav | да | ok / ok / - | - | - | - |
| compact-panes | да | ok / ok / - | - | - | - |
| compact-rail | да | - / ok / - | - | - | - |
| companion-chat | да | ok / ok / - | - | - | - |
| composer-autocollapse | да | ok / ok / - | - | - | - |
| composer-predictions | да | ok / ok / - | - | - | - |
| conductor-theme | да | - / ok / - | - | - | - |
| context-handoff | да | ok / ok / - | - | - | - |
| context-health | да | ok / ok / ok | - | - | - |
| context-meter | да | ok / ok / - | - | - | - |
| copilot-aic-usage | да | ok / ok / ok | engines.bbPluginSdk >=0.5.9 <0.6 -> engines.aliaPluginSdk >=0.6 (SDK 0.6.143) | - | - |
| copilot-session-credits | да | ok / ok / ok | - | - | - |
| copilot-usage | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm; имя пакета alia-copilot-usage даёт id "alia-copilot-usage", переименовано в alia-plugin-bb-copilot-usage | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| copy-session-id | да | ok / ok / - | - | - | - |
| cortado | да | - / ok / - | - | - | - |
| crew | да | ok / ok / - | - | - | - |
| ctrl-enter-send | да | ok / ok / - | - | - | - |
| cua-driver | да | ok / ok / ok | убрана зависимость bb-app (devDependencies) | - | - |
| cursor-sidebar | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm; переименовано файлов с bb в имени: 1 | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | 15 |
| dashboard | да | ok / ok / - | - | - | - |
| decisions | да | ok / ok / - | - | - | - |
| deepseek-harness | да | ok / ok / - | - | - | - |
| dependabot | да | ok / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| design-director | да | - / ok / - | переименовано файлов с bb в имени: 2 | - | - |
| desktop-browser-agent | да | ok / ok / ok | убрана зависимость bb-app (devDependencies) | - | - |
| devin | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| diagram-fences | да | ok / ok / - | - | - | - |
| dictation-shortcuts | да | ok / ok / - | - | - | - |
| diff-explorer | да | ok / ok / ok | - | - | - |
| diff-plus | да | ok / ok / - | - | - | - |
| diff-review | да | ok / ok / ok | - | - | - |
| diff-tree | да | ok / ok / ok | - | - | - |
| diff-viewed | **нет** | ok / fail / - | - | server: Build failed with 1 error: diff-viewed/server.ts:10:46: ERROR: Could not resolve "@danielb/gh-shared/gh" | 4 |
| diffdad | да | ok / ok / - | - | - | - |
| discord | да | ok / ok / - | убрана зависимость bb-app (devDependencies); переименовано файлов с bb в имени: 2 | - | - |
| disk-usage | да | ok / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| doc-review | да | ok / ok / - | - | - | - |
| dockside | да | ok / ok / - | - | - | - |
| drmanhattan | после публикации SDK | - / - / - | убрана зависимость bb-app (devDependencies); SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| droid | да | ok / ok / ok | - | - | - |
| dynamic-file-tree | да | ok / ok / - | - | - | - |
| e-corp | да | - / ok / - | - | - | - |
| elephant-goldfish | да | ok / ok / - | переименовано файлов с bb в имени: 2 | - | - |
| emoji-react | да | ok / ok / - | переименовано файлов с bb в имени: 2 | - | - |
| env-catalog | да | ok / ok / - | - | - | - |
| extella | да | - / ok / - | - | - | - |
| factory | да | ok / ok / ok | - | - | - |
| factory-droid | да | ok / ok / - | - | - | - |
| fast-archive | да | ok / ok / - | - | - | - |
| fast-split | да | ok / ok / - | - | - | - |
| fat-fingers | да | ok / ok / - | - | - | - |
| feature-flags | да | ok / ok / - | - | - | - |
| feed | да | ok / ok / - | - | - | - |
| file-explorer | да | ok / ok / ok | - | - | - |
| file-gateway | да | ok / ok / ok | - | - | - |
| file-manager | да | ok / ok / - | - | - | - |
| file-pins | да | ok / ok / ok | - | - | 10 |
| file-pretty | да | ok / ok / - | - | - | - |
| file-tree | да | ok / ok / ok | - | - | - |
| file-versions | да | ok / ok / - | - | - | - |
| files | да | ok / ok / - | engines.bbPluginSdk ^0.4.1 -> engines.aliaPluginSdk >=0.6 (SDK 0.6.143); переименовано файлов с bb в имени: 2 | - | - |
| files-editor | да | ok / ok / ok | - | - | - |
| finder | да | ok / ok / - | - | - | - |
| firstmate | да | ok / ok / - | переименовано файлов с bb в имени: 5 | - | - |
| firstmate-crew | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm; переименовано файлов с bb в имени: 2 | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| flare | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| flexible-worktrees | да | ok / ok / ok | - | - | - |
| flexoki | да | - / ok / - | - | - | - |
| floating-notes | да | ok / ok / - | - | - | - |
| floating-terminal | да | ok / ok / - | - | - | - |
| focus-board | да | ok / ok / - | переименовано файлов с bb в имени: 16 | - | - |
| focus-mode | да | ok / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| focus-sidebar | да | ok / ok / - | - | - | - |
| followups | да | ok / ok / - | - | - | - |
| fonts | да | ok / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| forage | да | ok / ok / - | - | - | - |
| fx | после публикации SDK | - / - / - | убрана зависимость bb-app (devDependencies); SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| genui | да | ok / ok / - | переименовано файлов с bb в имени: 2 | - | - |
| gh-copilot | да | ok / ok / - | - | - | - |
| gh-projects-board | да | ok / ok / - | - | - | - |
| gh-stack | да | ok / ok / - | - | - | - |
| ghostrunner | да | - / ok / - | - | - | - |
| gigaam | да | - / ok / ok | - | - | - |
| git-graph | да | ok / ok / - | - | - | - |
| git-history | после публикации SDK | - / - / - | убрана зависимость bb-app (devDependencies); SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| git-panel | да | ok / ok / ok | - | - | - |
| git-worktrees | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| gitea | да | ok / ok / ok | - | - | - |
| github-actions | да | ok / ok / - | - | - | - |
| github-app-auth | да | ok / ok / - | - | - | - |
| github-board | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| github-extended | да | ok / ok / - | - | - | - |
| github-folder | да | ok / ok / - | - | - | - |
| github-pr-dashboard | да | ok / ok / - | имя пакета alia-github-pr-dashboard даёт id "alia-github-pr-dashboard", переименовано в alia-plugin-bb-github-pr-dashboard | - | - |
| github-projects | да | ok / ok / - | - | - | - |
| gitlab | да | ok / ok / - | - | - | - |
| gitlab-interface-notion-style | да | ok / ok / - | - | - | - |
| glass | да | ok / ok / - | - | - | - |
| goals | да | ok / ok / - | - | - | - |
| gone-fishing | да | ok / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| google-antigravity-acp | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| graph-studio | да | ok / ok / - | - | - | - |
| graphite-mono | да | - / ok / - | - | - | - |
| graphite-stack | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| grok-build-usage | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| gtd-sidebar | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| guest-view | да | ok / ok / - | - | - | - |
| guided-review | да | ok / ok / - | - | - | - |
| handoff | да | ok / ok / - | - | - | - |
| hands-free | да | ok / ok / - | - | - | - |
| handsfree | да | ok / ok / - | - | - | - |
| harness | да | ok / ok / - | - | - | - |
| hashstash | да | ok / ok / - | - | - | - |
| hats | да | ok / ok / - | - | - | - |
| haze | да | ok / ok / - | - | - | - |
| header-pins | да | ok / ok / - | - | - | - |
| headroom | да | - / ok / - | - | - | - |
| herald | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm; переименовано файлов с bb в имени: 3 | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| herdr-theme | да | ok / ok / - | - | - | - |
| hex | да | ok / ok / - | - | - | - |
| higgsfield | да | ok / ok / ok | - | - | - |
| hmm-floating-terminal | да | ok / ok / - | - | - | - |
| home-hero | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| homepage | да | ok / ok / - | убрана зависимость bb-app (devDependencies); переименовано файлов с bb в имени: 1 | - | - |
| hooks | да | ok / ok / - | - | - | - |
| host-monitor | да | ok / ok / ok | убрана зависимость bb-app (devDependencies) | - | - |
| host-pulse | да | ok / ok / - | - | - | - |
| hotspot | да | ok / ok / - | - | - | - |
| human-tasks | да | ok / ok / - | - | - | - |
| image-diff | да | ok / ok / ok | - | - | - |
| image-preview | да | ok / ok / - | - | - | - |
| image-studio | да | ok / ok / ok | - | - | - |
| impromptu-ui | **нет** | fail / ok / - | - | app: Build failed with 1 error: node_modules/@danielbachhuber/bb-plugin-component-library/start-thread/start-thread.tsx:14:7: ERROR: Could not resolve "@get-bb/plugin-sdk/app" | 8 |
| inbox | да | ok / ok / - | - | - | - |
| inline-comments | да | ok / ok / - | - | - | - |
| inline-review | да | ok / ok / - | - | - | - |
| inline-terminal | да | ok / ok / - | - | - | - |
| ios-simulator | да | ok / ok / - | - | - | - |
| iris | да | ok / ok / - | переименовано файлов с bb в имени: 4 | - | - |
| jb-flow | да | ok / ok / - | - | - | - |
| jetbrains-central | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| jev-please-proceed | да | - / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| jira | да | ok / ok / - | переименовано файлов с bb в имени: 1 | - | - |
| jira-boards | да | ok / ok / - | - | - | - |
| jira-dc | да | ok / ok / - | - | - | - |
| kata | да | ok / ok / - | - | - | - |
| keep-last-blocks-open | да | ok / ok / - | - | - | - |
| kernel-browser | да | ok / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| kilocode | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| kimi-code | после публикации SDK | - / - / - | убрана зависимость bb-app (devDependencies); SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm; переименовано файлов с bb в имени: 1 | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| kimi-quota | да | - / ok / - | - | - | - |
| kimi-usage | да | - / ok / ok | - | - | - |
| kodaforge | да | ok / ok / ok | - | - | - |
| korey | да | ok / ok / ok | убрана зависимость bb-app (devDependencies) | - | - |
| kujo | да | ok / ok / - | engines.bb >=0.43.0 <0.44.0 -> engines.alia >=0.49 (alia-core 0.49.0); engines.bbPluginSdk >=0.4.84 <0.5.0 -> engines.aliaPluginSdk >=0.6 (SDK 0.6.143); имя пакета alia-kujo даёт id "alia-kujo", переименовано в alia-plugin-bb-kujo; переименовано файлов с bb в имени: 4 | - | - |
| lame-duck | да | ok / ok / - | - | - | - |
| launchd-jobs | да | ok / ok / ok | - | - | - |
| lavender | да | - / ok / - | - | - | - |
| learning-exercises | да | ok / ok / - | переименовано файлов с bb в имени: 2 | - | - |
| lego | да | ok / ok / - | - | - | - |
| letta-agents | да | ok / ok / - | - | - | - |
| limits | да | ok / ok / - | engines.bbPluginSdk ^0.4.1 -> engines.aliaPluginSdk >=0.6 (SDK 0.6.143); переименовано файлов с bb в имени: 2 | - | - |
| linear | да | ok / ok / - | переименовано файлов с bb в имени: 1 | - | - |
| linear-card | да | ok / ok / - | - | - | - |
| link-hovercards | да | ok / ok / ok | - | - | - |
| liquid-glass | да | ok / ok / - | - | - | - |
| live-markdown | да | ok / ok / - | - | - | - |
| lobu | да | ok / ok / - | - | - | - |
| lock-area | да | ok / ok / ok | переименовано файлов с bb в имени: 2 | - | - |
| loom | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm; переименовано файлов с bb в имени: 2 | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| mac-watch | да | ok / ok / - | - | - | - |
| machine-load | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| machine-monitor | да | ok / ok / ok | - | - | - |
| machine-sidebar | да | ok / ok / - | - | - | - |
| machine-status | да | ok / ok / ok | - | - | - |
| magic-compose | да | ok / ok / ok | - | - | - |
| magpie | да | ok / ok / ok | - | - | - |
| mane-control | да | ok / ok / - | - | - | - |
| markdown-editor | да | ok / ok / - | - | - | - |
| markdown-reader | да | ok / ok / ok | - | - | - |
| matt-pocock-skills-for-vesnalia | да | ok / ok / - | имя пакета alia-plugin-matt-pocock-skills-for-alia даёт id "matt-pocock-skills-for-alia", переименовано в alia-plugin-matt-pocock-skills-for-bb; переименовано файлов с bb в имени: 1 | - | - |
| mattermost | да | ok / ok / ok | - | - | - |
| maxwell | да | ok / ok / - | - | - | - |
| mcp-hub | да | ok / ok / ok | - | - | - |
| mcp-manager | да | ok / ok / ok | - | - | - |
| md-editor | да | ok / ok / - | - | - | - |
| md-prompt | да | ok / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| media-viewer | да | ok / ok / - | - | - | - |
| meetings | да | ok / ok / ok | переименовано файлов с bb в имени: 1 | - | - |
| memory-explorer | да | ok / ok / - | - | - | - |
| message-date-time | да | ok / ok / - | - | - | - |
| message-timestamps | да | ok / ok / - | engines.bbPluginSdk ^0.4.1 -> engines.aliaPluginSdk >=0.6 (SDK 0.6.143); переименовано файлов с bb в имени: 2 | - | - |
| miku | да | ok / ok / - | - | - | - |
| millivolt | да | ok / ok / - | - | - | - |
| minimap | да | ok / ok / - | - | - | - |
| minus | да | ok / ok / - | - | - | - |
| moa | да | ok / ok / - | - | - | - |
| moa-provider | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| model-effort-badges | да | ok / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| model-favicons | да | ok / ok / - | - | - | - |
| model-presets | да | ok / ok / - | - | - | - |
| model-pricing | да | ok / ok / - | переименовано файлов с bb в имени: 1 | - | - |
| model-visibility | да | ok / ok / - | - | - | - |
| monokai | да | - / ok / - | переименовано файлов с bb в имени: 4 | - | - |
| multi-repo-git | да | ok / ok / ok | - | - | - |
| muse | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| my-jira | да | ok / ok / - | - | - | - |
| my-tasks | да | ok / ok / ok | - | - | - |
| nanogpt-provider | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm; переименовано файлов с bb в имени: 1 | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| nav-rail | да | ok / ok / - | - | - | - |
| nested-sidebar | да | ok / ok / ok | - | - | - |
| next-prompt | да | ok / ok / - | - | - | - |
| next-step | да | ok / ok / ok | - | - | - |
| noema | да | - / ok / - | - | - | - |
| noisegate | да | - / ok / - | - | - | - |
| noted | да | ok / ok / - | - | - | - |
| notify | да | ok / ok / - | - | - | - |
| notify-feed | да | ok / ok / - | - | - | - |
| notion-theme | да | ok / ok / - | - | - | - |
| now-playing | да | ok / ok / - | - | - | - |
| nudge | да | ok / ok / - | - | - | - |
| nudger | да | ok / ok / - | - | - | - |
| ocean-dark | да | - / ok / - | - | - | - |
| oddship-gitea | да | ok / ok / ok | - | - | - |
| oddship-gitlab | да | ok / ok / - | - | - | - |
| office-viewer | да | ok / ok / - | - | - | - |
| ollama-fleet | да | ok / ok / - | - | - | - |
| ollama-usage | да | - / ok / ok | - | - | - |
| omarchy | да | ok / ok / ok | - | - | - |
| omp-agents | да | ok / ok / - | - | - | - |
| omp-subagents | да | ok / ok / ok | - | - | - |
| open-in-window | да | ok / ok / - | - | - | - |
| opencode2 | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| openrouter-inference | **нет** | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | npm install: npm error code E404 npm error 404 Not Found - GET https://registry.npmjs.org/@vesnalia%2fplugin-sdk - Not found npm error 404 npm error 404 The requested resource '@vesnalia/plugin-sdk@^0.6.143' could not be found or you do not have permission to access it. npm error 404 npm error 404 Note that you ; с опубликованным SDK: host: Build failed with 1 error: host.ts:7:52: ERROR: Could not resolve "@vesnalia/plugin-sdk/ai-services" | - |
| openspec | после публикации SDK | - / - / - | убрана зависимость bb-app (devDependencies); SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm; переименовано файлов с bb в имени: 1 | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| openspec-review | да | ok / ok / ok | переименовано файлов с bb в имени: 1 | - | - |
| openui | да | ok / ok / - | - | - | - |
| operator-inbox | да | ok / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| orchestrator-mode | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| otel | да | - / ok / - | - | - | - |
| pad | да | ok / ok / - | - | - | - |
| pane-workspaces | да | ok / ok / - | - | - | - |
| password-gate | да | ok / ok / - | - | - | - |
| peek | да | ok / ok / - | - | - | - |
| pets | да | ok / ok / - | переименовано файлов с bb в имени: 2 | - | - |
| pi-command-sync | после публикации SDK | - / - / - | engines.bb 0.45.0 -> engines.alia >=0.49 (alia-core 0.49.0); engines.bbPluginSdk 0.6.15 -> engines.aliaPluginSdk >=0.6 (SDK 0.6.143); SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm; переименовано файлов с bb в имени: 1 | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| pinch-zoom | да | ok / ok / - | - | - | - |
| pinned-turns | да | ok / ok / - | - | - | - |
| plain-paste | да | ok / ok / - | - | - | - |
| plan-mode | да | ok / ok / - | - | - | - |
| plan-progress | да | ok / ok / ok | - | - | - |
| play-continue | да | ok / ok / - | - | - | - |
| plugin-updates | да | ok / ok / - | переименовано файлов с bb в имени: 2 | - | - |
| plugin-vault | да | ok / ok / - | - | - | - |
| plugin-workshop | да | ok / ok / - | - | - | - |
| pokecut-theme | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| pokemon | да | ok / ok / - | - | - | - |
| pokemon-catcher | да | ok / ok / ok | - | - | - |
| polza | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm; переименовано файлов с bb в имени: 2 | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| pool-usage | да | ok / ok / - | - | - | - |
| pr-manager | да | ok / ok / ok | - | - | - |
| pr-notes | да | ok / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| pr-xray | да | ok / ok / - | - | - | - |
| preset-buttons | да | ok / ok / - | - | - | - |
| preset-sync | да | ok / ok / - | - | - | 1 |
| prime-agent-acp | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| productive | после публикации SDK | - / - / - | убрана зависимость bb-app (devDependencies); SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| progressive-skill | да | - / ok / - | - | - | - |
| project-colors | да | ok / ok / - | - | - | - |
| project-explorer | да | ok / ok / ok | - | - | - |
| project-folders | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm; переименовано файлов с bb в имени: 4 | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| project-instructions | да | ok / ok / - | - | - | - |
| project-page | да | ok / ok / - | - | - | - |
| project-themes | да | ok / ok / - | - | - | - |
| project-usage-sort | да | - / ok / - | - | - | - |
| prolepsia | да | - / ok / - | - | - | - |
| prompt-enhancer | да | ok / ok / - | - | - | - |
| prompt-log | да | ok / ok / - | - | - | - |
| prompt-shaper | да | ok / ok / - | engines.bbPluginSdk ^0.4.16 -> engines.aliaPluginSdk >=0.6 (SDK 0.6.143); переименовано файлов с bb в имени: 1 | - | - |
| prompts | да | ok / ok / - | - | - | - |
| provider-authentication | да | ok / ok / ok | - | - | - |
| provider-brand-marks | да | ok / ok / - | - | - | - |
| provider-muse | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| provider-retry-advanced | да | - / ok / - | - | - | - |
| provider-usage | да | ok / ok / - | переименовано файлов с bb в имени: 1 | - | - |
| pstack | да | - / ok / - | - | - | - |
| pstack-for-vesnalia | да | ok / ok / - | имя пакета alia-plugin-pstack-for-alia даёт id "pstack-for-alia", переименовано в alia-plugin-pstack-for-bb; переименовано файлов с bb в имени: 1 | - | - |
| pulse | да | ok / ok / - | переименовано файлов с bb в имени: 1 | - | - |
| px0 | да | ok / ok / ok | убрана зависимость bb-app (devDependencies) | - | - |
| px0-review | да | ok / ok / ok | - | - | - |
| qlik-sense | да | ok / ok / ok | - | - | - |
| quick-chat | да | ok / ok / - | - | - | - |
| quick-compose | да | ok / ok / - | - | - | - |
| quick-reply | да | ok / ok / - | - | - | - |
| quick-thread | да | ok / ok / - | - | - | - |
| qwen-cli | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| rad-binder | да | - / ok / - | - | - | - |
| radar | да | ok / ok / - | переименовано файлов с bb в имени: 1 | - | - |
| radar-sidebar | да | ok / ok / - | - | - | - |
| read-aloud | да | ok / ok / - | - | - | - |
| realtime-gateway | да | - / ok / - | - | - | - |
| recap | да | ok / ok / - | имя пакета alia-recap даёт id "alia-recap", переименовано в alia-plugin-bb-recap; переименовано файлов с bb в имени: 1 | - | - |
| receipts | да | ok / ok / - | - | - | - |
| reclaim | да | ok / ok / - | - | - | - |
| references | да | ok / ok / - | - | - | - |
| rephrase | да | ok / ok / - | - | - | - |
| responsibilities | да | ok / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| retitle | да | ok / ok / - | - | - | - |
| reveal-in-finder | да | ok / ok / - | - | - | - |
| rewind | да | ok / ok / ok | - | - | - |
| role-picker | да | ok / ok / - | - | - | - |
| route | да | - / ok / - | - | - | - |
| rpiv-todo-renderer | да | ok / ok / - | имя пакета alia-rpiv-todo-renderer даёт id "alia-rpiv-todo-renderer", переименовано в alia-plugin-bb-rpiv-todo-renderer | - | - |
| rtk | да | - / ok / - | - | - | - |
| save-my-model | да | ok / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| scoped-skills | да | ok / ok / - | - | - | - |
| screen-sharing | да | ok / ok / ok | переименовано файлов с bb в имени: 1 | - | - |
| screenshot | да | ok / ok / ok | - | - | - |
| section-load-more | да | ok / ok / - | - | - | - |
| security-guidance | да | - / ok / - | - | - | - |
| sentry-issues | да | ok / ok / - | - | - | - |
| server-status | да | ok / ok / - | - | - | - |
| session-history | да | ok / ok / - | - | - | - |
| session-log | да | ok / ok / - | - | - | - |
| session-notes | да | ok / ok / - | - | - | - |
| sessions-switcher | да | ok / ok / - | - | - | - |
| shell-tasks | да | ok / ok / ok | - | - | - |
| shipyard | да | ok / ok / - | - | - | - |
| shop-kanban | да | ok / ok / ok | - | - | - |
| shortcut | да | ok / ok / - | engines.bbPluginSdk ^0.4.1 -> engines.aliaPluginSdk >=0.6 (SDK 0.6.143); убрана зависимость bb-app (devDependencies); переименовано файлов с bb в имени: 2 | - | - |
| show-latest-threads | да | ok / ok / - | - | - | - |
| shuttle | да | ok / ok / - | переименовано файлов с bb в имени: 2 | - | - |
| side-board | да | ok / ok / - | - | - | - |
| side-chat-links | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| sidebar-plus | да | ok / ok / - | - | - | - |
| sidebar-subtitles | да | ok / ok / - | - | - | - |
| simple-sidebar-folders | да | ok / ok / - | - | - | - |
| simple-summaries | да | ok / ok / - | - | - | - |
| skiff | да | - / ok / - | - | - | - |
| skill-library | да | ok / ok / - | - | - | - |
| skill-manager | да | ok / ok / - | - | - | - |
| skills | да | ok / ok / ok | переименовано файлов с bb в имени: 1 | - | - |
| slopcop | да | ok / ok / - | - | - | - |
| smart-queue | да | ok / ok / - | - | - | - |
| sops | да | ok / ok / - | - | - | - |
| souls | да | ok / ok / - | - | - | - |
| spaces | да | ok / ok / - | - | - | - |
| specs | да | ok / ok / - | - | - | - |
| sql | да | ok / ok / - | - | - | - |
| steel-browser | да | ok / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| stelow | да | ok / ok / - | переименовано файлов с bb в имени: 7 | - | - |
| sticky-prompt | да | ok / ok / - | - | - | - |
| stl-preview | да | ok / ok / - | - | - | - |
| subscription-pace | да | ok / ok / - | - | - | - |
| subscriptions | да | ok / ok / - | - | - | - |
| subthread-columns | да | ok / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| super-diff | да | ok / ok / - | - | - | 4 |
| switchboard | да | ok / ok / - | - | - | - |
| syns | да | - / ok / ok | переименовано файлов с bb в имени: 1 | - | - |
| system-messages-tab | да | ok / ok / - | - | - | - |
| t3-import | да | - / ok / - | engines.bb >=0.45 <0.46 -> engines.alia >=0.49 (alia-core 0.49.0); переименовано файлов с bb в имени: 2 | - | - |
| t3sidebar | да | ok / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| tab-close-right | да | ok / ok / - | - | - | - |
| table-expand | да | ok / ok / - | - | - | - |
| tabs | да | ok / ok / - | переименовано файлов с bb в имени: 2 | - | - |
| taskboard | да | ok / ok / ok | убрана зависимость bb-app (devDependencies); переименовано файлов с bb в имени: 1 | - | 1 |
| tasks-kanban | да | ok / ok / - | - | - | - |
| team | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| telegram-projects | да | ok / ok / - | - | - | - |
| terminal-jobs | да | - / ok / ok | - | - | - |
| terminal-toggle | да | ok / ok / - | - | - | - |
| terminals | да | ok / ok / - | переименовано файлов с bb в имени: 3 | - | - |
| theme-glass | да | - / ok / - | - | - | - |
| theme-toggle | да | ok / ok / - | - | - | - |
| thread-glow | да | ok / ok / - | - | - | - |
| thread-hover-cards | да | ok / ok / - | engines.bbPluginSdk ^0.4.1 -> engines.aliaPluginSdk >=0.6 (SDK 0.6.143) | - | - |
| thread-images | да | ok / ok / - | - | - | - |
| thread-namer | да | ok / ok / - | - | - | - |
| thread-names | да | - / ok / - | - | - | - |
| thread-nicknames | да | ok / ok / - | - | - | - |
| thread-pages | да | - / ok / - | - | - | - |
| thread-reference | да | ok / ok / - | - | - | - |
| thread-reveal | да | ok / ok / - | - | - | - |
| thread-switcher | да | ok / ok / - | - | - | - |
| thread-tabs | да | ok / ok / - | engines.bb >=0.48.1 <0.49.0 -> engines.alia >=0.49 (alia-core 0.49.0) | - | - |
| thread-tags | да | ok / ok / - | - | - | - |
| thread-time-machine | да | ok / ok / - | - | - | - |
| thread-tree | да | ok / ok / - | - | - | - |
| threadline | да | ok / ok / - | - | - | - |
| threadspace | да | ok / ok / - | - | - | - |
| timer | да | ok / ok / - | - | - | - |
| tinted-threads | да | ok / ok / - | - | - | - |
| token-guard | да | ok / ok / - | - | - | - |
| token-pass-pace | да | ok / ok / - | - | - | - |
| tokenmaxx | да | ok / ok / - | - | - | - |
| tokenomics | да | ok / ok / - | - | - | 12 |
| tokyo-night | да | - / ok / - | - | - | - |
| top-tabs | да | ok / ok / - | - | - | - |
| touchbar | да | - / ok / - | убрана зависимость bb-app (devDependencies); переименовано файлов с bb в имени: 2 | - | - |
| trace-mcp | да | ok / ok / ok | - | - | - |
| traces | да | ok / ok / ok | engines.bbPluginSdk ^0.4.8 -> engines.aliaPluginSdk >=0.6 (SDK 0.6.143) | - | - |
| tracing | да | ok / ok / - | - | - | - |
| tree-sidebar | да | ok / ok / - | engines.bbPluginSdk ^0.4.1 -> engines.aliaPluginSdk >=0.6 (SDK 0.6.143); переименовано файлов с bb в имени: 2 | - | - |
| treehouse | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| treelanes | да | ok / ok / - | переименовано файлов с bb в имени: 1 | - | - |
| triage | да | ok / ok / - | engines.bbPluginSdk ^0.4.47 -> engines.aliaPluginSdk >=0.6 (SDK 0.6.143); переименовано файлов с bb в имени: 2 | - | - |
| try-it | да | ok / ok / - | - | - | - |
| turn-tps | да | ok / ok / - | - | - | - |
| typewriter | да | ok / ok / - | - | - | - |
| typography | да | ok / ok / - | - | - | - |
| ui-scale | да | ok / ok / - | - | - | - |
| ui-tweaks | да | ok / ok / - | убрана зависимость bb-app (devDependencies); переименовано файлов с bb в имени: 1 | - | 2 |
| ultra-launcher | да | ok / ok / - | - | - | - |
| ultragoal | да | ok / ok / ok | - | - | - |
| unified-inbox | да | ok / ok / - | - | - | - |
| unslop | да | - / ok / - | - | - | - |
| uptime | да | ok / ok / - | - | - | - |
| usage | да | ok / ok / - | engines.bbPluginSdk ^0.4.1 -> engines.aliaPluginSdk >=0.6 (SDK 0.6.143); переименовано файлов с bb в имени: 2 | - | - |
| usage-bar | да | ok / ok / - | - | - | - |
| usage-forecast | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| usage-limits | да | ok / ok / - | - | - | - |
| usage-meter | да | ok / ok / - | - | - | - |
| usage-pace | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| usage-page | да | ok / ok / - | engines.bbPluginSdk ^0.4.1 -> engines.aliaPluginSdk >=0.6 (SDK 0.6.143); переименовано файлов с bb в имени: 2 | - | - |
| usage-tracker | да | ok / ok / ok | убрана зависимость bb-app (devDependencies) | - | - |
| vantage | да | ok / ok / ok | - | - | - |
| variaq | да | - / ok / - | engines.bb >=0.46.0 <0.47.0 -> engines.alia >=0.49 (alia-core 0.49.0); engines.bbPluginSdk 0.6.37 -> engines.aliaPluginSdk >=0.6 (SDK 0.6.143); убрана зависимость bb-app (devDependencies) | - | - |
| vcs-widget | да | ok / ok / ok | убрана зависимость bb-app (devDependencies) | - | - |
| vercel-theme | да | - / ok / - | - | - | - |
| vesnalia-agent-toolbox | да | - / ok / - | имя пакета alia-plugin-alia-agent-toolbox даёт id "alia-agent-toolbox", переименовано в alia-plugin-bb-agent-toolbox; переименовано файлов с bb в имени: 1 | - | - |
| vesnalia-bbs | да | ok / ok / - | - | - | - |
| vesnalia-box | да | ok / ok / ok | имя пакета alia-plugin-alia-box даёт id "alia-box", переименовано в alia-plugin-bb-box; переименовано файлов с bb в имени: 34 | - | - |
| vesnalia-live | да | ok / ok / - | имя пакета alia-plugin-alia-live даёт id "alia-live", переименовано в alia-plugin-bb-live; переименовано файлов с bb в имени: 1 | - | - |
| vesnalia-office | да | ok / ok / - | убрана зависимость bb-app (devDependencies); имя пакета alia-plugin-alia-office даёт id "alia-office", переименовано в alia-plugin-bb-office; переименовано файлов с bb в имени: 1 | - | - |
| vesnalia-sidebar | да | ok / ok / ok | убрана зависимость bb-app (devDependencies); имя пакета alia-plugin-alia-sidebar даёт id "alia-sidebar", переименовано в alia-plugin-bb-sidebar; переименовано файлов с bb в имени: 7 | - | - |
| vesper | да | - / ok / - | - | - | - |
| vim | да | ok / ok / - | - | - | - |
| visual-workflows | да | ok / ok / - | - | - | - |
| voice-input | да | ok / ok / ok | - | - | - |
| voice-mode | да | ok / ok / - | - | - | - |
| vps-watch | да | ok / ok / - | - | - | - |
| vscode-server | да | ok / ok / - | - | - | - |
| waiting-on-you | да | ok / ok / - | - | - | - |
| wakatime | да | ok / ok / - | - | - | - |
| web-push-notify | да | ok / ok / - | engines.bbPluginSdk ^0.4.1 -> engines.aliaPluginSdk >=0.6 (SDK 0.6.143); убрана зависимость bb-app (devDependencies); переименовано файлов с bb в имени: 2 | - | - |
| wiki | да | ok / ok / - | - | - | - |
| wikilinks | да | ok / ok / - | - | - | - |
| wizbar | да | ok / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| work-map | да | ok / ok / - | - | - | - |
| workbench-explorer | да | ok / ok / ok | - | - | - |
| workspace-sidebar | да | ok / ok / - | - | - | - |
| workspace-skills | да | - / ok / - | - | - | - |
| workspaces | да | ok / ok / ok | - | - | - |
| worktree-ports | да | ok / ok / ok | - | - | - |
| worktree-setup | да | ok / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| wterm-terminal-preview | да | ok / ok / - | engines.bbPluginSdk ^0.4.1 -> engines.aliaPluginSdk >=0.6 (SDK 0.6.143); убрана зависимость bb-app (devDependencies) | - | - |
| x-viral | да | ok / ok / - | - | - | - |
| xberg | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| xcode | да | ok / ok / ok | - | - | - |
| xlsx-preview | **нет** | - / - / - | - | сборка не проверялась | 22 |
| zcode | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm; переименовано файлов с bb в имени: 2 | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| zcode-acp | после публикации SDK | - / - / - | убрана зависимость bb-app (devDependencies); SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm; переименовано файлов с bb в имени: 1 | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| zcode-provider | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm; переименовано файлов с bb в имени: 3 | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| zen-koi | да | ok / ok / - | - | - | - |
| zh-cn | да | ok / ok / - | - | - | - |
