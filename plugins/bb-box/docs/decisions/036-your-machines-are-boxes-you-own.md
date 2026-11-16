# 036: Your machines are boxes you own, kept as VesnALIA machines

Status: accepted, 1 October 2026. Extends
[032](032-spare-boxes-are-enrolled-ahead.md): a spare that a thread starts
on through VesnALIA's picker becomes yours. Amended since: a spare becomes yours
when VesnALIA says a thread on its machine is working (#155), and a stopped one
does too (#156).

## Context

"New box" ([033](033-a-thread-can-start-on-a-new-box.md)) is hard to find
in VesnALIA's new-thread picker. The operator asked to add boxes in VesnALIA Box's
settings, as machines in VesnALIA's list and sidebar, like any other (#144).

## Decision

**Owner.** A box can belong to you, not to a thread. Its record is a box
record of the reserved thread `operator`, as spares are of `spare` (032),
with no project and role "box". VesnALIA's thread IDs never take that form. You
name it when you add it: a hostname label, unique among your machines.
That name is also its VesnALIA machine's name. It is outside the per-thread
limit, and counts against a backend's room like any box.

**Adding and removing.** VesnALIA Box's settings list your machines and add one
of any kind that can enrol, at any size, desktops included. Adding goes
through acquire, so it takes a spare when one fits, renamed. It enrols
under its box ID, whatever the general enrolment setting. It is removed
only in settings, or by removing its machine in VesnALIA.
[034](034-a-working-thread-holds-its-box.md) applies: settings asks before
removing or stopping one a thread is working on.

**Lifecycle.**

- The sweep never releases it, as its thread `operator` is always live.
- A lost record is restored from the guest's owner label
  ([019](019-lost-records-are-restored-from-guests.md)) to you, with its
  name. The box enrols again under its ID, and VesnALIA gives back its machine
  ([025](025-a-restored-box-enrols-again.md)).
- After a start it reconnects as any enrolled box does
  ([017](017-boxes-clear-alia-daemon-state-at-boot.md)).
- When you remove its machine in VesnALIA, alia-box releases the box. `remove`
  first clears the box's machine, so the release does not delete it
  again, which would wait on VesnALIA's removal (as found in #125).

**Where it shows.**

- VesnALIA's machine list, sidebar and new-thread picker, under your name.
- In a thread that runs on a box's machine, `box_list` and the Box panel
  show that box as "the machine this thread runs on", and the box tools
  take it. `box_release` and `box_stop` refuse it, and point to settings.
- The Desktops page lists your machines' desktops under "Your machines".

**Spare guard.** A spare whose machine gets a thread through VesnALIA's picker
becomes yours. A claim skips it, and the spare upkeep moves it to you, with
the "(spare)" dropped from its machine's name, and makes a new spare. The
upkeep runs when VesnALIA says a thread on a spare's machine was created or is
working, as well as at each sweep. A stopped spare with a thread becomes
yours too, still stopped, and reconnects when you start it. A thread counts
while it is neither archived nor deleted.

## Consequences

- One way to keep a box as a machine, which you can see and remove.
- A spare you start a thread on stays until you remove it in settings.
- Kinds that cannot enrol, such as Windows, cannot be your machines yet.
