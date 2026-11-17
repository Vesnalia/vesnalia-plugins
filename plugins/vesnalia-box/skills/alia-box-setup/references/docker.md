# Docker

Docker boxes are containers on one Docker host. They make `linux`,
`linux-desktop-cpu`, `linux-desktop-wayland-cpu`, and `linux-desktop` on a
GPU. A box is ready in about a second. The full guide is
`setup/docker/README.md` in alia-box's repository.

Before anything, tell the person: by default each box is a privileged
container with Docker of its own, so a box can take over its Docker host.
Ask whether that is acceptable. If it is not, set `--field privileged=false`:
boxes then have no Docker. A Docker box has no systemd and no disk size of
its own.

## On the machine that runs VesnALIA, or on one of their VesnALIA machines

This is the quickest path, and the first choice for "set up boxes here".

```sh
alia machine list                      # which machines there are
alia box setup docker                  # the machine that runs ALIA
alia box setup docker --machine <name> # one of their ALIA machines, by name or ID
```

It turns Docker on for that machine, with the Linux image alone. It also
turns on the nightly rebuild of images, and waits while the image builds:
5 to 12 minutes, or up to 15 on a slow machine. Run it as a background task
if you can. `--no-wait` starts it and says how far the build is; run the
command again to see.

- Where VesnALIA's user cannot use Docker, it prints the lines that fix it, such
  as adding the user to the `docker` group. Those are for the person to
  run, as they need root. Ask them to run them, then run the command again.
- Where it says "Boxes will not join VesnALIA yet", VesnALIA's machine access needs an
  address boxes can reach: see "When it goes wrong" in SKILL.md. Settle it
  before you prove the backend, or the first box does not enrol.
- Where the machine has no Docker, it says so. Docker Engine must be
  installed first: ask the person, as it needs root.
- The backend it adds is `docker:<machine name>`. `alia box backend list`
  shows it.
- It saves the desktop image fields empty, so the backend offers no
  desktops. To offer the X11 desktop, run `alia box backend set
  docker:<name> --unset desktop-image`, then `alia box docker-build <machine>`,
  which builds what is missing there. All three images need about 36 GB
  free.

## On a Linux host over SSH

Ask for the host's address, the user that may use Docker there, and
whether the user VesnALIA runs as can already log in to it with a key and no
prompt.

1. On the machine that runs VesnALIA, as the user VesnALIA runs as, check:
   `DOCKER_HOST=ssh://<user>@<host> docker info`.
2. Build the images there, from a checkout of alia-box at the installed
   commit: `DOCKER_HOST=ssh://<user>@<host> setup/docker/build.sh linux`.
   Leave out `linux` for all three images: it takes about 15 minutes and 36
   GB of disk. `build.sh linux desktop` builds two.
3. Add the backend. Give it an ID of its own when there is a Docker backend
   already:

   ```sh
   alia box backend add docker --id build-1 --field host=ssh://box@192.0.2.40 \
     --field desktop-image= --field wayland-desktop-image= --check
   alia box backend add docker --id build-1 --field host=ssh://box@192.0.2.40 \
     --field desktop-image= --field wayland-desktop-image=
   ```

   An empty image field turns that kind off on this backend. Leave the image
   fields out when all three images are built.

## In WSL on a Windows PC

A Windows PC can host boxes in a WSL distribution. Docker stays on the
distribution's unix socket. The person runs `setup/docker-wsl/setup.ps1` on
the PC, in PowerShell 7 as an administrator. Follow
`setup/docker-wsl/README.md`.

When VesnALIA's server is another machine and the PC is a VesnALIA machine, the
backend's `host` is already `alia:<machine ID>`. Set `machine-docker-host` to
`wsl://<distro>` (the distribution the script created, `aliadocker` unless
they named another):

```sh
alia box backend set docker:<name> --field machine-docker-host=wsl://aliadocker
```

alia-box sends that when the machine's relay opens. The Windows daemon dials
`wsl.exe` and `docker system dial-stdio`. Leave the machine's `DOCKER_HOST`
and docker context alone. Do not set them to `wsl://`: `docker.exe` does not
understand it. `tcp://127.0.0.1:2375` is WSL's localhost forwarder, which
drops attached output, so `docker exec` prints nothing and exits 0.

When VesnALIA runs on the PC itself, set `host` to `wsl://aliadocker` instead.
When the PC is not a VesnALIA machine, set `host` to `ssh://box@<pc>:2222`.

## Fields worth knowing

`alia box backend fields docker` lists them all.

| Field | Default | What it does |
| --- | --- | --- |
| `host` | empty | `unix:///path/docker.sock`, `ssh://user@host`, `wsl://distro`, `tcp://host:port`, `alia:<machine ID>`, or empty for the `docker` CLI's own default |
| `machine-docker-host` | empty | For a `alia:<machine ID>` host: `wsl://distro`, a unix socket or `tcp://host:port` on that machine. Empty leaves the machine's own `DOCKER_HOST`. On Windows set `wsl://<distro>` |
| `linux-image`, `desktop-image`, `wayland-desktop-image` | `aliabox/...:1` | The image of each kind. Empty turns the kind off here |
| `privileged` | `true` | Boxes have Docker of their own and can take over the host |
| `gpus` | `false` | GPU boxes: offers `linux` with a GPU and `linux-desktop` on the host's NVIDIA cards, through CDI. Unset, the replaced `gpu-desktops` is read |
| `boxes-per-card` | 4 | The most boxes on one card, of every install, running or stopped. Unset, the replaced `desktops-per-gpu` is read |
| `whole-cards` | unset | A card to itself for a box. Unset, `general.wholeCards` says, off unless set |
| `gpu-memory-mib` | 1024 | The memory a card must have free for a new server |
| `boxes` | 10 | The most alia-box containers on the host |
| `reserve-memory-mib` | 4096 | Memory a new box leaves free. Lower it on a host with 8 GiB |

## Check and prove

`alia box doctor` checks the `docker` CLI, the daemon, the CPU and memory
limits, LXCFS, each image and the room on the host. "has no image" means the
build has not run on the host the `host` field names. Prove it with a
`linux` box: `alia box acquire linux --on <backend ID>`.

Boxes join VesnALIA by reaching VesnALIA's server URL from inside the container. If VesnALIA
listens only on localhost, they cannot. Either turn enrolment off, with
`alia box option set enrol=false`, or have VesnALIA listen on an address the
containers reach.
