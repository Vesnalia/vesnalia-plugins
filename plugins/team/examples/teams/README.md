# Example team

`dev.yaml` is a ready development team: a lead on a strong model, a developer,
a junior on a cheap local model (the lead is woken after each of its turns via `notifyOn`),
and a tester in a separate environment taken from `vars`. Roles without
`promptFile` use the built-in prompt of their `kind`.

Пример команды разработки: руководитель на сильной модели, разработчик,
младший разработчик на дешёвой локальной модели и тестировщик в отдельном
окружении из `vars`. Роли без `promptFile` получают встроенный промпт своего
вида (`kind`).

```bash
mkdir -p <project>/.vesnalia/teams && cp -r dev.yaml dev <project>/.vesnalia/teams/
alia team doctor --team dev --project <project>
alia team create --team dev --project <project>
```
