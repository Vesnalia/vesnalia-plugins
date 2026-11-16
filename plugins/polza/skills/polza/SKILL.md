---
name: polza
description: Polza provider for VesnALIA — check the Polza sign-in, balance, key limit and the models offered in the picker; change the picker models. Use when a thread runs on the Polza provider or the user asks about Polza balance, models or sign-in.
---

# Polza provider

`alia polza status [--json]` prints the sign-in state, the organisation balance
(`available` is what a request may spend), the key's spend limit and the
models offered in VesnALIA's model picker. Signing in and topping up happen in the
VesnALIA UI (Settings → Plugins → Polza) and on https://polza.ai/dashboard; do not
ask the user for the key.

`alia polza models [--json]` lists the picker models in order; the first is the
default. `alia polza models set <slug>…` replaces that list with catalog slugs
such as `anthropic/claude-sonnet-5.5` or `openai/gpt-5.4`. The full catalog is
public: `curl -s https://polza.ai/api/v1/models?type=chat`.

Costs: every Polza thread shows an estimated ruble spend above the composer.
It is computed from token counts and catalog prices, so it is an estimate; the
dashboard's history is the billing truth. A 402 means the balance or the key's
spend limit is exhausted.
