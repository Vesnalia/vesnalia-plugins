# Состояние плагинов

Проверка: копия плагина, `npm install --omit=dev --ignore-scripts` и сборка app/server/host сборщиком alia-core (`packages/plugin-build`), как сервер делает при установке из git. Скрипт - `scripts/verify.mjs`, сырые результаты - `data/verify.json`, полная таблица - `status.json`.

Всего 576: собирается 401, соберётся после публикации `@vesnalia/plugin-sdk` в npm 46, сломано 129.

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
| agent-checklists | **нет** | - / - / - | - | сборка не проверялась | - |
| agent-graph | да | ok / ok / - | - | - | - |
| agent-icons | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| agent-lanes | да | ok / ok / - | переименовано файлов с bb в имени: 1 | - | - |
| agent-plugins | **нет** | - / - / - | - | сборка не проверялась | - |
| agent-proxy | да | ok / ok / - | - | - | - |
| agent-reload | да | ok / ok / - | - | - | - |
| agent-retry | да | - / ok / - | - | - | - |
| agent-roles | да | ok / ok / - | - | - | - |
| agent-tools | да | ok / ok / ok | - | - | - |
| agent-traces | да | ok / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| agent-tv | да | ok / ok / - | - | - | - |
| agentic-mermaid | да | ok / ok / - | - | - | - |
| aif-chat | **нет** | - / - / - | - | сборка не проверялась | - |
| airbender | да | ok / ok / - | - | - | - |
| android-emulator | да | ok / ok / ok | - | - | - |
| animation | да | ok / ok / - | - | - | - |
| antigravity | **нет** | - / - / - | - | сборка не проверялась | - |
| antigravity-cli | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| app-preview | **нет** | - / - / - | - | сборка не проверялась | - |
| arc-switcher | **нет** | - / - / - | engines.bbPluginSdk ^0.4.1 -> engines.aliaPluginSdk >=0.6 (SDK 0.6.143); переименовано файлов с bb в имени: 2 | сборка не проверялась | - |
| archive-section | да | - / ok / - | - | - | - |
| archived-toggle | да | ok / ok / - | - | - | - |
| artifacts | **нет** | - / - / - | - | сборка не проверялась | - |
| asana | да | ok / ok / - | - | - | - |
| asciimoji | **нет** | - / - / - | - | сборка не проверялась | - |
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
| automation-palette | **нет** | - / - / - | - | сборка не проверялась | 4 |
| autoresearch-self-loop | да | ok / ok / - | - | - | - |
| autorouter | **нет** | - / - / - | - | сборка не проверялась | - |
| aws-activate-usage | да | ok / ok / - | - | - | - |
| ayu | да | ok / ok / - | - | - | - |
| backlog | да | ok / ok / ok | engines.bbPluginSdk ^0.5.9 -> engines.aliaPluginSdk >=0.6 (SDK 0.6.143); переименовано файлов с bb в имени: 2 | - | - |
| ballast | **нет** | - / - / - | - | сборка не проверялась | - |
| bang-shell | **нет** | - / - / - | - | сборка не проверялась | - |
| battery | **нет** | - / - / - | - | сборка не проверялась | - |
| bb-agent-toolbox | да | - / ok / - | имя пакета alia-plugin-alia-agent-toolbox даёт id "alia-agent-toolbox", переименовано в alia-plugin-bb-agent-toolbox; переименовано файлов с bb в имени: 1 | - | - |
| bb-antigravity-usage | да | - / ok / ok | имя пакета alia-antigravity-usage даёт id "alia-antigravity-usage", переименовано в alia-plugin-bb-antigravity-usage | - | - |
| bb-autoresearch | да | ok / ok / ok | имя пакета alia-autoresearch даёт id "alia-autoresearch", переименовано в alia-plugin-bb-autoresearch; переименовано файлов с bb в имени: 1 | - | 6 |
| bb-better-latex | да | ok / ok / - | имя пакета alia-better-latex даёт id "alia-better-latex", переименовано в alia-plugin-bb-better-latex | - | - |
| bb-box | да | ok / ok / ok | имя пакета alia-plugin-alia-box даёт id "alia-box", переименовано в alia-plugin-bb-box; переименовано файлов с bb в имени: 34 | - | - |
| bb-copilot-usage | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm; имя пакета alia-copilot-usage даёт id "alia-copilot-usage", переименовано в alia-plugin-bb-copilot-usage | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| bb-github-pr-dashboard | да | ok / ok / - | имя пакета alia-github-pr-dashboard даёт id "alia-github-pr-dashboard", переименовано в alia-plugin-bb-github-pr-dashboard | - | - |
| bb-kujo | да | ok / ok / - | engines.bb >=0.43.0 <0.44.0 -> engines.alia >=0.49 (alia-core 0.49.0); engines.bbPluginSdk >=0.4.84 <0.5.0 -> engines.aliaPluginSdk >=0.6 (SDK 0.6.143); имя пакета alia-kujo даёт id "alia-kujo", переименовано в alia-plugin-bb-kujo; переименовано файлов с bb в имени: 4 | - | - |
| bb-live | да | ok / ok / - | имя пакета alia-plugin-alia-live даёт id "alia-live", переименовано в alia-plugin-bb-live; переименовано файлов с bb в имени: 1 | - | - |
| bb-office | да | ok / ok / - | убрана зависимость bb-app (devDependencies); имя пакета alia-plugin-alia-office даёт id "alia-office", переименовано в alia-plugin-bb-office; переименовано файлов с bb в имени: 1 | - | - |
| bb-recap | да | ok / ok / - | имя пакета alia-recap даёт id "alia-recap", переименовано в alia-plugin-bb-recap; переименовано файлов с bb в имени: 1 | - | - |
| bb-rpiv-todo-renderer | да | ok / ok / - | имя пакета alia-rpiv-todo-renderer даёт id "alia-rpiv-todo-renderer", переименовано в alia-plugin-bb-rpiv-todo-renderer | - | - |
| bb-sidebar | да | ok / ok / ok | убрана зависимость bb-app (devDependencies); имя пакета alia-plugin-alia-sidebar даёт id "alia-sidebar", переименовано в alia-plugin-bb-sidebar; переименовано файлов с bb в имени: 7 | - | - |
| bbbbs | да | ok / ok / - | - | - | - |
| bbium | да | ok / ok / - | - | - | - |
| beacon | **нет** | - / - / - | - | сборка не проверялась | - |
| beads | да | - / ok / ok | - | - | - |
| beautiful-chat | да | ok / ok / - | - | - | - |
| beside | да | ok / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| boat | да | - / ok / - | - | - | - |
| bookmarks | **нет** | - / - / - | - | сборка не проверялась | - |
| bots | да | ok / ok / - | - | - | - |
| bots-sidebar | **нет** | - / - / - | - | сборка не проверялась | - |
| branch-graph | да | ok / ok / ok | - | - | - |
| breathe | да | ok / ok / - | - | - | - |
| browser-annotate | **нет** | - / - / - | - | сборка не проверялась | - |
| browser-copy | да | ok / ok / ok | - | - | - |
| browser-gestures | да | ok / ok / - | - | - | - |
| browser-session-import | да | ok / ok / ok | - | - | - |
| browser-tools | да | - / ok / ok | - | - | - |
| browserbase | да | - / ok / - | - | - | - |
| btrfs-cow | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| bureaucat | **нет** | - / - / - | - | сборка не проверялась | - |
| burn | да | ok / ok / ok | переименовано файлов с bb в имени: 5 | - | - |
| cache-watch | да | ok / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| callstack | **нет** | - / - / - | - | сборка не проверялась | - |
| calm | да | ok / ok / - | переименовано файлов с bb в имени: 1 | - | - |
| canvas | **нет** | - / - / - | - | сборка не проверялась | - |
| captains-deck | да | ok / ok / - | - | - | - |
| career-hub | **нет** | - / - / - | - | сборка не проверялась | - |
| cascade | да | ok / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| catchup | да | ok / ok / - | - | - | - |
| change-gate | да | ok / ok / - | - | - | - |
| chat-dock | да | ok / ok / - | - | - | - |
| chat-find | да | ok / ok / - | - | - | - |
| chat-search | **нет** | - / - / - | - | сборка не проверялась | - |
| chat-sidebar | да | ok / ok / - | - | - | - |
| chat-width | да | ok / ok / - | engines.bb >=0.47.1 <0.48.0 -> engines.alia >=0.49 (alia-core 0.49.0); убрана зависимость bb-app (devDependencies) | - | - |
| chatgpt-skin | **нет** | - / - / - | переименовано файлов с bb в имени: 1 | сборка не проверялась | - |
| chief | да | ok / ok / - | - | - | - |
| chime | да | ok / ok / - | - | - | - |
| claude-account-switcher | да | ok / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| claude-accounts | **нет** | - / - / - | - | сборка не проверялась | - |
| claude-auth | **нет** | - / - / - | - | сборка не проверялась | - |
| claude-switcher | да | ok / ok / - | переименовано файлов с bb в имени: 2 | - | - |
| claude-theme | да | - / ok / - | - | - | - |
| claude-usage | да | ok / ok / - | - | - | - |
| cli-agents | да | ok / ok / ok | - | - | - |
| clickable-local-link | да | ok / ok / - | - | - | - |
| close-tab | **нет** | - / - / - | - | сборка не проверялась | - |
| cloud-sandbox | **нет** | - / - / - | - | сборка не проверялась | - |
| code-review | **нет** | - / - / - | - | сборка не проверялась | - |
| code-review-workspace | да | ok / ok / - | - | - | - |
| codex-migrate | **нет** | - / - / - | engines.bb >=0.44 <0.45 -> engines.alia >=0.49 (alia-core 0.49.0); переименовано файлов с bb в имени: 2 | сборка не проверялась | - |
| codex-realtime | да | - / ok / - | - | - | - |
| codex-theme | да | ok / ok / - | переименовано файлов с bb в имени: 3 | - | - |
| collapsible-navigation | да | ok / ok / - | - | - | - |
| color-swatches | **нет** | - / - / - | engines.bbPluginSdk ^0.4.1 -> engines.aliaPluginSdk >=0.6 (SDK 0.6.143) | сборка не проверялась | - |
| command-center | **нет** | - / - / - | - | сборка не проверялась | - |
| command-code | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| compact-nav | да | ok / ok / - | - | - | - |
| compact-panes | **нет** | - / - / - | - | сборка не проверялась | - |
| compact-rail | **нет** | - / - / - | - | сборка не проверялась | - |
| companion-chat | да | ok / ok / - | - | - | - |
| composer-autocollapse | да | ok / ok / - | - | - | - |
| composer-predictions | да | ok / ok / - | - | - | - |
| conductor-theme | да | - / ok / - | - | - | - |
| context-handoff | да | ok / ok / - | - | - | - |
| context-health | да | ok / ok / ok | - | - | - |
| context-meter | **нет** | - / - / - | - | сборка не проверялась | - |
| copilot-aic-usage | да | ok / ok / ok | engines.bbPluginSdk >=0.5.9 <0.6 -> engines.aliaPluginSdk >=0.6 (SDK 0.6.143) | - | - |
| copilot-session-credits | да | ok / ok / ok | - | - | - |
| copy-session-id | **нет** | - / - / - | - | сборка не проверялась | - |
| cortado | да | - / ok / - | - | - | - |
| crew | да | ok / ok / - | - | - | - |
| ctrl-enter-send | **нет** | - / - / - | - | сборка не проверялась | - |
| cua-driver | да | ok / ok / ok | убрана зависимость bb-app (devDependencies) | - | - |
| cursor-sidebar | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm; переименовано файлов с bb в имени: 1 | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | 15 |
| dashboard | да | ok / ok / - | - | - | - |
| decisions | **нет** | - / - / - | - | сборка не проверялась | - |
| deepseek-harness | да | ok / ok / - | - | - | - |
| dependabot | да | ok / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| design-director | да | - / ok / - | переименовано файлов с bb в имени: 2 | - | - |
| desktop-browser-agent | да | ok / ok / ok | убрана зависимость bb-app (devDependencies) | - | - |
| devin | **нет** | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | сборка не проверялась | - |
| diagram-fences | **нет** | - / - / - | - | сборка не проверялась | - |
| dictation-shortcuts | да | ok / ok / - | - | - | - |
| diff-explorer | да | ok / ok / ok | - | - | - |
| diff-plus | да | ok / ok / - | - | - | - |
| diff-review | да | ok / ok / ok | - | - | - |
| diff-tree | да | ok / ok / ok | - | - | - |
| diff-viewed | **нет** | - / - / - | - | сборка не проверялась | 4 |
| diffdad | **нет** | - / - / - | - | сборка не проверялась | - |
| discord | **нет** | - / - / - | убрана зависимость bb-app (devDependencies); переименовано файлов с bb в имени: 2 | сборка не проверялась | - |
| disk-usage | да | ok / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| doc-review | да | ok / ok / - | - | - | - |
| dockside | да | ok / ok / - | - | - | - |
| drmanhattan | после публикации SDK | - / - / - | убрана зависимость bb-app (devDependencies); SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| droid | да | ok / ok / ok | - | - | - |
| dynamic-file-tree | да | ok / ok / - | - | - | - |
| e-corp | да | - / ok / - | - | - | - |
| elephant-goldfish | да | ok / ok / - | переименовано файлов с bb в имени: 2 | - | - |
| emoji-react | **нет** | - / - / - | переименовано файлов с bb в имени: 2 | сборка не проверялась | - |
| env-catalog | да | ok / ok / - | - | - | - |
| extella | да | - / ok / - | - | - | - |
| factory | да | ok / ok / ok | - | - | - |
| factory-droid | **нет** | - / - / - | - | сборка не проверялась | - |
| fast-archive | да | ok / ok / - | - | - | - |
| fast-split | да | ok / ok / - | - | - | - |
| fat-fingers | да | ok / ok / - | - | - | - |
| feature-flags | **нет** | - / - / - | - | сборка не проверялась | - |
| feed | да | ok / ok / - | - | - | - |
| file-explorer | **нет** | - / - / - | - | сборка не проверялась | - |
| file-gateway | да | ok / ok / ok | - | - | - |
| file-manager | да | ok / ok / - | - | - | - |
| file-pins | **нет** | - / - / - | - | сборка не проверялась | 10 |
| file-pretty | да | ok / ok / - | - | - | - |
| file-tree | **нет** | - / - / - | - | сборка не проверялась | - |
| file-versions | да | ok / ok / - | - | - | - |
| files | да | ok / ok / - | engines.bbPluginSdk ^0.4.1 -> engines.aliaPluginSdk >=0.6 (SDK 0.6.143); переименовано файлов с bb в имени: 2 | - | - |
| files-editor | да | ok / ok / ok | - | - | - |
| finder | **нет** | - / - / - | - | сборка не проверялась | - |
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
| git-worktrees | **нет** | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | сборка не проверялась | - |
| gitea | да | ok / ok / ok | - | - | - |
| github-actions | да | ok / ok / - | - | - | - |
| github-app-auth | да | ok / ok / - | - | - | - |
| github-board | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| github-extended | да | ok / ok / - | - | - | - |
| github-folder | **нет** | - / - / - | - | сборка не проверялась | - |
| github-projects | **нет** | - / - / - | - | сборка не проверялась | - |
| gitlab | да | ok / ok / - | - | - | - |
| gitlab-interface-notion-style | да | ok / ok / - | - | - | - |
| glass | **нет** | - / - / - | - | сборка не проверялась | - |
| goals | да | ok / ok / - | - | - | - |
| gone-fishing | да | ok / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| google-antigravity-acp | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| graph-studio | да | ok / ok / - | - | - | - |
| graphite-mono | **нет** | - / - / - | - | сборка не проверялась | - |
| graphite-stack | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| grok-build-usage | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| gtd-sidebar | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| guest-view | да | ok / ok / - | - | - | - |
| guided-review | да | ok / ok / - | - | - | - |
| handoff | да | ok / ok / - | - | - | - |
| hands-free | **нет** | - / - / - | - | сборка не проверялась | - |
| handsfree | **нет** | - / - / - | - | сборка не проверялась | - |
| harness | да | ok / ok / - | - | - | - |
| hashstash | **нет** | - / - / - | - | сборка не проверялась | - |
| hats | да | ok / ok / - | - | - | - |
| haze | да | ok / ok / - | - | - | - |
| header-pins | да | ok / ok / - | - | - | - |
| headroom | **нет** | - / - / - | - | сборка не проверялась | - |
| herald | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm; переименовано файлов с bb в имени: 3 | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| herdr-theme | да | ok / ok / - | - | - | - |
| hex | да | ok / ok / - | - | - | - |
| higgsfield | да | ok / ok / ok | - | - | - |
| hmm-floating-terminal | да | ok / ok / - | - | - | - |
| home-hero | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| homepage | да | ok / ok / - | убрана зависимость bb-app (devDependencies); переименовано файлов с bb в имени: 1 | - | - |
| hooks | да | ok / ok / - | - | - | - |
| host-monitor | да | ok / ok / ok | убрана зависимость bb-app (devDependencies) | - | - |
| host-pulse | **нет** | - / - / - | - | сборка не проверялась | - |
| hotspot | да | ok / ok / - | - | - | - |
| human-tasks | да | ok / ok / - | - | - | - |
| image-diff | да | ok / ok / ok | - | - | - |
| image-preview | **нет** | - / - / - | - | сборка не проверялась | - |
| image-studio | да | ok / ok / ok | - | - | - |
| impromptu-ui | **нет** | - / - / - | - | сборка не проверялась | 8 |
| inbox | да | ok / ok / - | - | - | - |
| inline-comments | да | ok / ok / - | - | - | - |
| inline-review | да | ok / ok / - | - | - | - |
| inline-terminal | **нет** | - / - / - | - | сборка не проверялась | - |
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
| lame-duck | да | ok / ok / - | - | - | - |
| launchd-jobs | да | ok / ok / ok | - | - | - |
| lavender | да | - / ok / - | - | - | - |
| learning-exercises | да | ok / ok / - | переименовано файлов с bb в имени: 2 | - | - |
| lego | да | ok / ok / - | - | - | - |
| letta-agents | да | ok / ok / - | - | - | - |
| limits | **нет** | - / - / - | engines.bbPluginSdk ^0.4.1 -> engines.aliaPluginSdk >=0.6 (SDK 0.6.143); переименовано файлов с bb в имени: 2 | сборка не проверялась | - |
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
| machine-monitor | **нет** | - / - / - | - | сборка не проверялась | - |
| machine-sidebar | да | ok / ok / - | - | - | - |
| machine-status | да | ok / ok / ok | - | - | - |
| magic-compose | да | ok / ok / ok | - | - | - |
| magpie | да | ok / ok / ok | - | - | - |
| mane-control | да | ok / ok / - | - | - | - |
| markdown-editor | **нет** | - / - / - | - | сборка не проверялась | - |
| markdown-reader | **нет** | - / - / - | - | сборка не проверялась | - |
| matt-pocock-skills-for-bb | да | ok / ok / - | имя пакета alia-plugin-matt-pocock-skills-for-alia даёт id "matt-pocock-skills-for-alia", переименовано в alia-plugin-matt-pocock-skills-for-bb; переименовано файлов с bb в имени: 1 | - | - |
| mattermost | **нет** | - / - / - | - | сборка не проверялась | - |
| maxwell | **нет** | - / - / - | - | сборка не проверялась | - |
| mcp-hub | **нет** | - / - / - | - | сборка не проверялась | - |
| mcp-manager | **нет** | - / - / - | - | сборка не проверялась | - |
| md-editor | да | ok / ok / - | - | - | - |
| md-prompt | да | ok / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| media-viewer | да | ok / ok / - | - | - | - |
| meetings | да | ok / ok / ok | переименовано файлов с bb в имени: 1 | - | - |
| memory-explorer | да | ok / ok / - | - | - | - |
| message-date-time | да | ok / ok / - | - | - | - |
| message-timestamps | **нет** | - / - / - | engines.bbPluginSdk ^0.4.1 -> engines.aliaPluginSdk >=0.6 (SDK 0.6.143); переименовано файлов с bb в имени: 2 | сборка не проверялась | - |
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
| muse | **нет** | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | сборка не проверялась | - |
| my-jira | да | ok / ok / - | - | - | - |
| my-tasks | да | ok / ok / ok | - | - | - |
| nanogpt-provider | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm; переименовано файлов с bb в имени: 1 | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| nav-rail | да | ok / ok / - | - | - | - |
| nested-sidebar | **нет** | - / - / - | - | сборка не проверялась | - |
| next-prompt | да | ok / ok / - | - | - | - |
| next-step | да | ok / ok / ok | - | - | - |
| noema | **нет** | - / - / - | - | сборка не проверялась | - |
| noisegate | **нет** | - / - / - | - | сборка не проверялась | - |
| noted | да | ok / ok / - | - | - | - |
| notify | да | ok / ok / - | - | - | - |
| notify-feed | да | ok / ok / - | - | - | - |
| notion-theme | да | ok / ok / - | - | - | - |
| now-playing | да | ok / ok / - | - | - | - |
| nudge | да | ok / ok / - | - | - | - |
| nudger | да | ok / ok / - | - | - | - |
| ocean-dark | да | - / ok / - | - | - | - |
| oddship-gitea | **нет** | - / - / - | - | сборка не проверялась | - |
| oddship-gitlab | **нет** | - / - / - | - | сборка не проверялась | - |
| office-viewer | да | ok / ok / - | - | - | - |
| ollama-fleet | да | ok / ok / - | - | - | - |
| ollama-usage | да | - / ok / ok | - | - | - |
| omarchy | да | ok / ok / ok | - | - | - |
| omp-agents | **нет** | - / - / - | - | сборка не проверялась | - |
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
| pane-workspaces | **нет** | - / - / - | - | сборка не проверялась | - |
| password-gate | **нет** | - / - / - | - | сборка не проверялась | - |
| peek | **нет** | - / - / - | - | сборка не проверялась | - |
| pets | да | ok / ok / - | переименовано файлов с bb в имени: 2 | - | - |
| pi-command-sync | после публикации SDK | - / - / - | engines.bb 0.45.0 -> engines.alia >=0.49 (alia-core 0.49.0); engines.bbPluginSdk 0.6.15 -> engines.aliaPluginSdk >=0.6 (SDK 0.6.143); SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm; переименовано файлов с bb в имени: 1 | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| pinch-zoom | да | ok / ok / - | - | - | - |
| pinned-turns | да | ok / ok / - | - | - | - |
| plain-paste | да | ok / ok / - | - | - | - |
| plan-mode | **нет** | - / - / - | - | сборка не проверялась | - |
| plan-progress | **нет** | - / - / - | - | сборка не проверялась | - |
| play-continue | да | ok / ok / - | - | - | - |
| plugin-updates | да | ok / ok / - | переименовано файлов с bb в имени: 2 | - | - |
| plugin-vault | **нет** | - / - / - | - | сборка не проверялась | - |
| plugin-workshop | да | ok / ok / - | - | - | - |
| pokecut-theme | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| pokemon | да | ok / ok / - | - | - | - |
| pokemon-catcher | да | ok / ok / ok | - | - | - |
| polza | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm; переименовано файлов с bb в имени: 2 | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| pool-usage | **нет** | - / - / - | - | сборка не проверялась | - |
| pr-manager | **нет** | - / - / - | - | сборка не проверялась | - |
| pr-notes | да | ok / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| pr-xray | да | ok / ok / - | - | - | - |
| preset-buttons | да | ok / ok / - | - | - | - |
| preset-sync | да | ok / ok / - | - | - | 1 |
| prime-agent-acp | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| productive | после публикации SDK | - / - / - | убрана зависимость bb-app (devDependencies); SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| progressive-skill | да | - / ok / - | - | - | - |
| project-colors | **нет** | - / - / - | - | сборка не проверялась | - |
| project-explorer | да | ok / ok / ok | - | - | - |
| project-folders | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm; переименовано файлов с bb в имени: 4 | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| project-instructions | да | ok / ok / - | - | - | - |
| project-page | да | ok / ok / - | - | - | - |
| project-themes | да | ok / ok / - | - | - | - |
| project-usage-sort | да | - / ok / - | - | - | - |
| prolepsia | **нет** | - / - / - | - | сборка не проверялась | - |
| prompt-enhancer | да | ok / ok / - | - | - | - |
| prompt-log | **нет** | - / - / - | - | сборка не проверялась | - |
| prompt-shaper | **нет** | - / - / - | engines.bbPluginSdk ^0.4.16 -> engines.aliaPluginSdk >=0.6 (SDK 0.6.143); переименовано файлов с bb в имени: 1 | сборка не проверялась | - |
| prompts | да | ok / ok / - | - | - | - |
| provider-authentication | **нет** | - / - / - | - | сборка не проверялась | - |
| provider-brand-marks | да | ok / ok / - | - | - | - |
| provider-muse | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| provider-retry-advanced | да | - / ok / - | - | - | - |
| provider-usage | да | ok / ok / - | переименовано файлов с bb в имени: 1 | - | - |
| pstack | да | - / ok / - | - | - | - |
| pstack-for-bb | **нет** | - / - / - | имя пакета alia-plugin-pstack-for-alia даёт id "pstack-for-alia", переименовано в alia-plugin-pstack-for-bb; переименовано файлов с bb в имени: 1 | сборка не проверялась | - |
| pulse | да | ok / ok / - | переименовано файлов с bb в имени: 1 | - | - |
| px0 | **нет** | - / - / - | убрана зависимость bb-app (devDependencies) | сборка не проверялась | - |
| px0-review | **нет** | - / - / - | - | сборка не проверялась | - |
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
| receipts | да | ok / ok / - | - | - | - |
| reclaim | да | ok / ok / - | - | - | - |
| references | **нет** | - / - / - | - | сборка не проверялась | - |
| rephrase | да | ok / ok / - | - | - | - |
| responsibilities | да | ok / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| retitle | да | ok / ok / - | - | - | - |
| reveal-in-finder | **нет** | - / - / - | - | сборка не проверялась | - |
| rewind | да | ok / ok / ok | - | - | - |
| role-picker | да | ok / ok / - | - | - | - |
| route | да | - / ok / - | - | - | - |
| rtk | **нет** | - / - / - | - | сборка не проверялась | - |
| save-my-model | да | ok / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| scoped-skills | да | ok / ok / - | - | - | - |
| screen-sharing | да | ok / ok / ok | переименовано файлов с bb в имени: 1 | - | - |
| screenshot | **нет** | - / - / - | - | сборка не проверялась | - |
| section-load-more | да | ok / ok / - | - | - | - |
| security-guidance | да | - / ok / - | - | - | - |
| sentry-issues | да | ok / ok / - | - | - | - |
| server-status | да | ok / ok / - | - | - | - |
| session-history | да | ok / ok / - | - | - | - |
| session-log | да | ok / ok / - | - | - | - |
| session-notes | да | ok / ok / - | - | - | - |
| sessions-switcher | да | ok / ok / - | - | - | - |
| shell-tasks | да | ok / ok / ok | - | - | - |
| shipyard | **нет** | - / - / - | - | сборка не проверялась | - |
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
| skiff | **нет** | - / - / - | - | сборка не проверялась | - |
| skill-library | **нет** | - / - / - | - | сборка не проверялась | - |
| skill-manager | да | ok / ok / - | - | - | - |
| skills | да | ok / ok / ok | переименовано файлов с bb в имени: 1 | - | - |
| slopcop | да | ok / ok / - | - | - | - |
| smart-queue | **нет** | - / - / - | - | сборка не проверялась | - |
| sops | да | ok / ok / - | - | - | - |
| souls | да | ok / ok / - | - | - | - |
| spaces | да | ok / ok / - | - | - | - |
| specs | да | ok / ok / - | - | - | - |
| sql | да | ok / ok / - | - | - | - |
| steel-browser | да | ok / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| stelow | **нет** | - / - / - | переименовано файлов с bb в имени: 7 | сборка не проверялась | - |
| sticky-prompt | да | ok / ok / - | - | - | - |
| stl-preview | да | ok / ok / - | - | - | - |
| subscription-pace | да | ok / ok / - | - | - | - |
| subscriptions | **нет** | - / - / - | - | сборка не проверялась | - |
| subthread-columns | да | ok / ok / - | убрана зависимость bb-app (devDependencies) | - | - |
| super-diff | **нет** | - / - / - | - | сборка не проверялась | 4 |
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
| theme-glass | **нет** | - / - / - | - | сборка не проверялась | - |
| theme-toggle | да | ok / ok / - | - | - | - |
| thread-glow | **нет** | - / - / - | - | сборка не проверялась | - |
| thread-hover-cards | **нет** | - / - / - | engines.bbPluginSdk ^0.4.1 -> engines.aliaPluginSdk >=0.6 (SDK 0.6.143) | сборка не проверялась | - |
| thread-images | да | ok / ok / - | - | - | - |
| thread-namer | да | ok / ok / - | - | - | - |
| thread-names | да | - / ok / - | - | - | - |
| thread-nicknames | **нет** | - / - / - | - | сборка не проверялась | - |
| thread-pages | да | - / ok / - | - | - | - |
| thread-reference | да | ok / ok / - | - | - | - |
| thread-reveal | **нет** | - / - / - | - | сборка не проверялась | - |
| thread-switcher | **нет** | - / - / - | - | сборка не проверялась | - |
| thread-tabs | да | ok / ok / - | engines.bb >=0.48.1 <0.49.0 -> engines.alia >=0.49 (alia-core 0.49.0) | - | - |
| thread-tags | да | ok / ok / - | - | - | - |
| thread-time-machine | да | ok / ok / - | - | - | - |
| thread-tree | **нет** | - / - / - | - | сборка не проверялась | - |
| threadline | **нет** | - / - / - | - | сборка не проверялась | - |
| threadspace | да | ok / ok / - | - | - | - |
| timer | **нет** | - / - / - | - | сборка не проверялась | - |
| tinted-threads | да | ok / ok / - | - | - | - |
| token-guard | да | ok / ok / - | - | - | - |
| token-pass-pace | да | ok / ok / - | - | - | - |
| tokenmaxx | да | ok / ok / - | - | - | - |
| tokenomics | **нет** | - / - / - | - | сборка не проверялась | 12 |
| tokyo-night | да | - / ok / - | - | - | - |
| top-tabs | да | ok / ok / - | - | - | - |
| touchbar | да | - / ok / - | убрана зависимость bb-app (devDependencies); переименовано файлов с bb в имени: 2 | - | - |
| trace-mcp | да | ok / ok / ok | - | - | - |
| traces | **нет** | - / - / - | engines.bbPluginSdk ^0.4.8 -> engines.aliaPluginSdk >=0.6 (SDK 0.6.143) | сборка не проверялась | - |
| tracing | **нет** | - / - / - | - | сборка не проверялась | - |
| tree-sidebar | да | ok / ok / - | engines.bbPluginSdk ^0.4.1 -> engines.aliaPluginSdk >=0.6 (SDK 0.6.143); переименовано файлов с bb в имени: 2 | - | - |
| treehouse | после публикации SDK | - / - / - | SDK нужен установленным при сборке: @vesnalia/plugin-sdk в dependencies, установка ждёт публикации SDK в npm | нужен опубликованный в npm @vesnalia/plugin-sdk: сервер ставит зависимости git-плагина из npm, а SDK там пока нет; с пакетом SDK из alia-core собирается | - |
| treelanes | да | ok / ok / - | переименовано файлов с bb в имени: 1 | - | - |
| triage | да | ok / ok / - | engines.bbPluginSdk ^0.4.47 -> engines.aliaPluginSdk >=0.6 (SDK 0.6.143); переименовано файлов с bb в имени: 2 | - | - |
| try-it | да | ok / ok / - | - | - | - |
| turn-tps | **нет** | - / - / - | - | сборка не проверялась | - |
| typewriter | да | ok / ok / - | - | - | - |
| typography | да | ok / ok / - | - | - | - |
| ui-scale | да | ok / ok / - | - | - | - |
| ui-tweaks | да | ok / ok / - | убрана зависимость bb-app (devDependencies); переименовано файлов с bb в имени: 1 | - | 2 |
| ultra-launcher | да | ok / ok / - | - | - | - |
| ultragoal | да | ok / ok / ok | - | - | - |
| unified-inbox | **нет** | - / - / - | - | сборка не проверялась | - |
| unslop | **нет** | - / - / - | - | сборка не проверялась | - |
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
| vesper | да | - / ok / - | - | - | - |
| vim | **нет** | - / - / - | - | сборка не проверялась | - |
| visual-workflows | да | ok / ok / - | - | - | - |
| voice-input | **нет** | - / - / - | - | сборка не проверялась | - |
| voice-mode | да | ok / ok / - | - | - | - |
| vps-watch | да | ok / ok / - | - | - | - |
| vscode-server | да | ok / ok / - | - | - | - |
| waiting-on-you | да | ok / ok / - | - | - | - |
| wakatime | да | ok / ok / - | - | - | - |
| web-push-notify | **нет** | - / - / - | engines.bbPluginSdk ^0.4.1 -> engines.aliaPluginSdk >=0.6 (SDK 0.6.143); убрана зависимость bb-app (devDependencies); переименовано файлов с bb в имени: 2 | сборка не проверялась | - |
| wiki | **нет** | - / - / - | - | сборка не проверялась | - |
| wikilinks | да | ok / ok / - | - | - | - |
| wizbar | **нет** | - / - / - | убрана зависимость bb-app (devDependencies) | сборка не проверялась | - |
| work-map | да | ok / ok / - | - | - | - |
| workbench-explorer | да | ok / ok / ok | - | - | - |
| workspace-sidebar | да | ok / ok / - | - | - | - |
| workspace-skills | **нет** | - / - / - | - | сборка не проверялась | - |
| workspaces | да | ok / ok / ok | - | - | - |
| worktree-ports | да | ok / ok / ok | - | - | - |
| worktree-setup | **нет** | - / - / - | убрана зависимость bb-app (devDependencies) | сборка не проверялась | - |
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
