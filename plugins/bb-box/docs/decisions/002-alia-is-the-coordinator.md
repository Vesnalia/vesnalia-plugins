# 002: VesnALIA is the coordinator

Status: accepted, 30 September 2026.

## Context

Giving agents machines usually needs a control plane: auth, a scheduler, an
API, a web portal and a relay for desktops. VesnALIA already has most of this for
its threads.

## Decision

alia-box is a VesnALIA plugin with no service of its own.

- VesnALIA provides:
  - auth, threads, events and agent tools;
  - the panel and settings page;
  - HTTP and WebSocket routes;
  - plugin storage;
  - machine enrolment.
- The plugin calls each backend directly from the VesnALIA server.
- A box that can enrol becomes an ordinary VesnALIA machine. That is how it gets the
  thread's Git credentials and machine variables, and how a child thread can
  run on it.
- There is no separate coordinator, adapter, relay or portal to deploy.

## Consequences

- Setting up alia-box means installing a plugin and configuring a backend.
- The VesnALIA server must reach each backend's API and each box's transports. A
  backend whose boxes are not directly reachable composes a transport that
  tunnels, for example SSH through a jump host.
- alia-box depends on VesnALIA's plugin API, including experimental parts (WebSocket
  routes, machine providers). When alia-box needs something VesnALIA lacks, it asks
  VesnALIA for it rather than building around it.
- Desktop streams pass through the VesnALIA server, so its network and CPU carry
  them.
