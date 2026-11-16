# 025: A restored box enrols again, keyed by its box ID

Status: accepted, 1 October 2026. Partly supersedes
[019](019-lost-records-are-restored-from-guests.md): whether a restored box
is a VesnALIA machine. Partly superseded by
[026](026-a-restored-box-enrols-once-it-answers.md): a box restored stopped
or silent enrols once it answers.

## Context

Since 019 the sweep restores a lost box record from its guest's labels. The
restored record had enrolment off, so the box was no longer a VesnALIA machine:

- the thread could not use it as a machine, and its commands ran only
  through alia-box's transports
- if VesnALIA still had the box's machine, nothing removed it, since the box's
  release no longer knew it

alia-box creates a box's machine with the box ID as the key
([014](014-enrol-through-machine-providers.md)). VesnALIA's create is idempotent
by key. While VesnALIA has a machine with that key, create returns that machine
rather than making another. Once VesnALIA has removed it, create makes a new one
with the same key.

## Decision

- When the sweep restores a box whose guest runs and whose command
  transport answers, and `enrol-boxes` is on, alia-box enrols the box again
  with its box ID as the key, as it does after an acquire.
- If VesnALIA still has the machine, the box gets it back. If VesnALIA shows that
  machine disconnected, as after the box restarted, bootstrap runs with the
  same key to start VesnALIA's daemon again
  ([017](017-boxes-clear-alia-daemon-state-at-boot.md)). If VesnALIA no longer has
  the machine, VesnALIA makes it again.
- The enrolment is timed from the restore, not from the box's creation,
  which the restored record takes as its ready time. The log says "after
  the sweep restored it".
- A box that is restored stopped, or whose guest did not answer, is not
  enrolled.

## Consequences

- A restored box is a machine the thread can use again, and the thread's
  access is set up in it again.
- Releasing a restored box that enrolled again removes its machine from VesnALIA.
- A box restored stopped does not enrol when it starts again. alia-box cannot
  tell it from a box whose machine was removed in VesnALIA, and that machine must
  stay removed. If VesnALIA still has its machine, the machine stays in VesnALIA after
  the box is released, as before.
