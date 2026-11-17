#!/bin/sh
alia="${ALIA_CLI:-alia}"
for thread in $("$alia" thread list --json | python3 -c "import json, sys; data = json.load(sys.stdin); items = data if isinstance(data, list) else data.get('threads', data.get('items', [])); print(' '.join(item['id'] for item in items))"); do
  for box in $("$alia" box list --thread "$thread" | sed -n 's/^- \([a-z-]*\):.*/\1/p'); do
    "$alia" box release "$box" --thread "$thread" --force
  done
  "$alia" thread delete "$thread" --yes
done
"$alia" box list --all
"$alia" thread list
