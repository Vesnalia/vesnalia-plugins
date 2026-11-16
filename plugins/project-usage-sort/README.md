# alia-plugin-project-usage-sort

Sorts VesnALIA's project order by how often each project is used.

Every thread adds a weight of `0.5^(days since last update / halfLifeDays)` to
its project; projects are ordered by the total. The order is written to the
server's project order (project pickers, VesnALIA Sidebar) and to the built-in thread
list's `sidebar.sectionOrder`. With `autoSort` on it re-sorts hourly.

```
alia plugin install .
alia project-usage-sort preview   # ranking only
alia project-usage-sort apply     # sort now
```

Settings: `autoSort` (default on), `halfLifeDays` (14), `includeChildThreads` (off).

Development: `npm run typecheck`, `npm test`, `alia plugin build`.
