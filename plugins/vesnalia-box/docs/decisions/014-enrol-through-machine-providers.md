# 014: Boxes enrol through VesnALIA's machine provider API, when claimed

Status: accepted, 30 September 2026. Extended by
[017](017-boxes-clear-alia-daemon-state-at-boot.md): templates and images clear
VesnALIA's daemon lock and PID file at boot. Enrolment was measured at 1.7 to
2.5 s with the template, under the 3 s set in the consequences, so boxes
still enrol when claimed. Partly superseded by
[032](032-spare-boxes-are-enrolled-ahead.md): with VesnALIA 0.44 enrolment took
about 5 s, so spare boxes are enrolled ahead, and VesnALIA shows them until
claimed.

## Context

A box whose kind can enrol becomes a VesnALIA machine, so the thread's Git
credentials and machine variables reach it and child threads can run there
([002](002-alia-is-the-coordinator.md)). VesnALIA 0.44.0 offers plugins a machine
provider API: VesnALIA creates the host record, issues a one-time credential and
runs its own installer through an executor the plugin supplies.

The [enrolment research](../research/enrolment-and-warm-pools.md) found:

- nothing thread-specific is fixed at enrolment, because VesnALIA resolves the
  machine environment each time it is used;
- pre-installing alia-app in a template saves about 2 s;
- in a container with systemd, the installer's service dies with the SSH
  session unless the box user has linger;
- VesnALIA has no way to hide a machine from its machine list.

## Decision

- alia-box registers a machine provider. It enrols a box by creating a machine
  with the box ID as the key. The provider's `create` calls VesnALIA's `bootstrap`
  with an executor on the box's command transport.
- Templates and images carry Node.js, npm, curl and a pre-installed alia-app
  with its digest file. Where systemd runs, the box user has linger: a
  template sets it, and an SSH pool machine turns it on at claim, since its
  reset turns it off.
- A box enrols when it is claimed. Warm boxes are not enrolled ahead.
- Releasing a box removes its machine from VesnALIA before the backend releases the
  guest.

## Consequences

- alia-box never handles a long-lived VesnALIA credential. The one-time credential
  passes through the transport and is not stored or logged.
- A box runs commands before it is enrolled. Only VesnALIA's features wait for
  enrolment.
- Warm boxes stay out of VesnALIA's machine list, so no one starts a thread on an
  unclaimed box.
- If the timing experiment shows enrolment takes more than 3 s, pre-enrolling
  warm boxes and renaming them on claim is the next step, and gets its own
  record.
