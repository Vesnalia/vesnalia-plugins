---
name: alia-box-setup
description: Set up or change alia-box for a person from the command line. Covers its backends (Docker, Proxmox LXC and QEMU, Tart, the SSH host pool with its Macs and iOS hosts, microsandbox, Hetzner Cloud, Namespace, boat.dev), kinds and sizes, warm and spare boxes, the tailnet, images and the Monitor. Use it when asked to make boxes work somewhere, add a machine, or change alia-box's settings.
---

# Setting up alia-box

alia-box makes boxes for VesnALIA threads on backends: places that boxes come from.
This skill is for setting them up and changing them for a person, with the
`alia box` command. Using boxes is in the `alia-box` skill.

Never hand-edit the configuration's JSON. Each `alia box backend`, `alia box
kind` and `alia box option` command makes one checked save, as the settings
page does: it is refused on the same problems, it gets a revision and a
receipt, and it prints what changed. A backend change then prints the
backend's own checks.

## Ground rules

- **Ask before you act on what is not yours.** Ask before you run a script
  on a machine, make something that costs money, or turn on a backend whose
  boxes can take over their host. Docker boxes are privileged containers by
  default, so a box there is root on that machine. Say that plainly when you
  ask.
- **Never see a secret.** Get API tokens, keys and OAuth clients with `VesnALIA
  secret request`, which asks the person in a form and writes a dotenv file
  you never read. Pass that file to alia-box with `--secret`. Never put a
  secret on a command line, never `cat`, `grep` or print the file, and never
  copy a secret into a message. To test that a variable is there, print only
  yes or no: `grep -q '^NAME=' file && echo yes || echo no`.
- **Prove it with a box.** A backend is set up when a box made there
  answers, not when its settings save. Release the box after.
- **Say what you did.** Report each backend's state, the doctor's warnings
  and the box you proved it with. Report what you left for the person to do.

## The steps

1. **Look first.** `alia box doctor`, `alia box backend list`, `alia box kinds`
   and `alia machine list` show what is there. Do not add a second backend for
   something that is already set up.
2. **Choose a backend.** Use the table below. When the request is plain,
   such as "set up boxes here", suggest a backend on the machine that runs
   VesnALIA: Docker on Linux, Docker in WSL 2 on a Windows PC, and microsandbox on
   a Mac with Apple silicon, where Docker's x86_64 images run emulated.
3. **Ask what only the person knows.** Ask about the machine, its address,
   what it may cost, and whether privileged boxes are acceptable. Their
   backend's reference file lists what to ask.
4. **Prepare the host.** Run the backend's setup scripts where its
   reference says, as the user it says. Read what they print: the lines to
   add to alia-box, host keys, and warnings.
5. **Add it with a check first.** Run `alia box backend add <type> ... --check`
   to see the problems and run the backend's checks without saving. Then run
   it again without `--check`. A backend is on unless you give `--off`. Give
   `--off` to save it part way, such as before its host is ready.
6. **Read the checks.** A save prints the backend's checks, and exits 2
   when they fail. Fix what they say, then `alia box backend set <id> --check`.
   `alia box doctor` checks everything.
7. **Prove it.** Make a first box on it, run a command in it, and release
   it. In a VesnALIA thread:
   `box_acquire({kind: "linux", on: "<backend ID>"})`, `box_run` with
   `uname -a`, then `box_release`. From a terminal, the same is
   `alia box acquire linux --on <backend ID>`, `alia box run <box> "uname -a"`
   and `alia box release <box>`, each in the thread (`--thread <id>` names
   one). With no thread at all, make the box one of the person's machines:

   ```sh
   alia box machines add linux --on <backend ID> --name first-box
   alia box run first-box "uname -a; nproc" --machine
   alia box machines remove first-box
   ```

   Read the State line: `ready` with `ALIA machine: enrolled` is the proof.
   `failed` says why. `ready` with enrolment failed means the backend works
   but boxes cannot reach VesnALIA: see "Boxes will not join VesnALIA yet" under When
   it goes wrong, and tell the person; `alia box run` still works there.
   Remove the box whatever happened.

## Which backend

| The person has or wants | Backend | Reference |
| --- | --- | --- |
| Docker on the machine that runs VesnALIA, or on one of their VesnALIA machines | `docker`, through `alia box setup docker` | [docker.md](references/docker.md) |
| Docker on another Linux host over SSH, or in WSL on a Windows PC | `docker` | [docker.md](references/docker.md) |
| Linux boxes with a kernel of their own, beside Docker | `microsandbox` | [microsandbox.md](references/microsandbox.md) |
| A Proxmox VE host: Linux boxes and desktops, GPU desktops | `proxmox-lxc` | [proxmox.md](references/proxmox.md) |
| Windows desktops, Linux VMs or Android on Proxmox | `proxmox-qemu` | [proxmox.md](references/proxmox.md) |
| Macs with Apple silicon, for macOS, iOS, arm64 Linux and Windows VMs | `tart` | [tart.md](references/tart.md) |
| Their own Linux machines or Macs, each lent whole; iOS slots on a Mac | `ssh-pool` | [ssh-pool.md](references/ssh-pool.md) |
| No machine of their own: rented by the hour, minute or second | `hetzner`, `namespace`, `boat` | [cloud.md](references/cloud.md) |

`alia box backend types` lists every type with the kinds it makes and its
guide. `alia box backend fields <type>` lists a type's fields, what each
takes, whether it is a secret, and its default.

## The scripts

The setup scripts and guides are in alia-box's repository, at the version that
is installed. `alia plugin source alia-box` says where it came from. Installed
from a folder, the scripts are in that folder: copy them from there.
Installed from Git, it gives the URL and the commit: clone that commit where
you need the scripts:

```sh
git clone <url> alia-box && git -C alia-box checkout <commit>
```

Each backend's guide, such as `setup/docker/README.md`, says more than its
reference file here. Read it when a step fails or the person asks why.

## The commands

| Command | What it changes |
| --- | --- |
| `alia box backend add <type> [--id <name>]` | A new backend, on unless `--off` |
| `alia box backend set <id>` | A backend's fields, secrets, switch, name, warm boxes and the projects it is kept for |
| `alia box backend remove <id> --yes` | Removes a backend, with its secrets. Refused while it has boxes |
| `alia box backend host add\|set\|remove <id> <host>` | The hosts of a backend that has them, such as Tart's Macs |
| `alia box kind set <kind>` | A kind's switch, sizes, default size, largest size and spares, or makes it the default kind |
| `alia box option set <name>=<value>`, `alia box option unset <name>` | The general and Monitor options. `alia box option list` and `alia box option get <name>` show them |

They take these options:

- `--field key=value` sets a field, and `--unset key` gives it back its
  default. `key=` with nothing after it saves an empty value: for an image
  or template field, that turns its kind off on this backend.
- `--add-line key=line` and `--remove-line key=text` edit a field that holds
  lines, such as the SSH host pool's `machines`. `--field-file key=path`
  sets a field to a file's text.
- `--on` and `--off` turn a backend or host on and off. Off, it makes no new
  boxes, and its boxes keep working.
- `--warm kind=count` keeps ready boxes of a kind waiting on that backend.
- `--projects "Work, Client"` keeps a backend for those VesnALIA projects, by name
  or ID: only their threads see it, and they use it before shared backends,
  falling back to shared ones when it is full. Threads elsewhere, or in no
  project, never see it. `--projects ""` gives it back to every project.
  Ask which projects first: it is the person's choice, such as a work
  account kept for work. `alia box doctor` warns when none of its projects is
  still in VesnALIA.
- `--check` saves nothing. It says what would change, lists the problems
  and runs the backend's checks.
- `--revision n` saves only while the configuration is at revision `n`.
  Without it, the change is made on the latest revision.
- `--operation <id>` names the save. If an answer never comes, run the same
  command with the same ID. It is saved once, and the receipt says at which
  revision.
- `--json` prints the outcome as JSON: `saved`, `revision`, `operation`,
  `receipt`, `changes`, `problems` and `doctor`.

The exit code is 0 when it saved, 1 when nothing was saved, and 2 when it
saved but the backend's checks failed. `alia box config show` prints the whole
configuration, without secrets. A person can do the same on the settings
page's Configuration page: Export downloads that file, and Import checks one
and lists what it changes, before and after, before Apply.

## Secrets

Ask for the secret, then hand alia-box the file:

```sh
alia secret request HCLOUD_TOKEN --write-env "$ALIA_THREAD_STORAGE/alia-box.env" \
  --purpose "alia-box needs a Hetzner Cloud API token to make hosts" \
  --describe HCLOUD_TOKEN="Read & Write token of the project for alia-box"
grep '^HCLOUD_TOKEN=' "$ALIA_THREAD_STORAGE/alia-box.env" | \
  alia box backend add hetzner --secret token=HCLOUD_TOKEN --secrets-stdin
```

- `--secret field=VARIABLE` names a secret field and the variable that
  holds its value. Repeat it for each secret.
- `--secrets-stdin` reads one line from stdin: one `VARIABLE=value` line,
  or for several secrets at once the whole file in base64:
  `base64 < "$ALIA_THREAD_STORAGE/alia-box.env" | tr -d '\n' | alia box ... --secrets-stdin`.
  It works from any machine.
- `--secrets-file <path>` reads the dotenv file itself, on the machine VesnALIA's
  server runs on. Use it only when your thread runs on that machine.
- `--secret-file field=path` takes a whole file, such as an SSH private
  key, also on the machine VesnALIA's server runs on.
- `--clear-secret field` clears one.

A secret on the command line, as `--field token=...`, is refused, and the
value is not printed. alia-box shows a secret only as set or not set.
A value may hold `=` signs: only the first `=` on a line ends the name. A
line that is not `VARIABLE=value`, a comment or blank is refused, and the
error names only its line number, never the line or a value.

Several backends need an SSH key that their hosts accept. Leave
`ssh-private-key` empty, and alia-box makes one. Add the backend with `--off`,
then run `alia box backend set <id> --check`: a note in its checks gives the
public key, starting `ssh-ed25519`, to give the host's setup script.

## Kinds and sizes

A kind is a type of box, such as `linux` or `macos-desktop`. It is offered
when it is on and a backend that is on makes it. `alia box kinds` lists the
kinds on offer, their presets and their default.

- **Size**: `alia box kind set linux --cores 4` changes the cores of the
  kind's default preset. `--preset medium` changes another preset. Memory is
  `--memory-gib` and disk `--disk-gib`, or `base` for the image's own disk.
  `--default-preset medium` makes another preset the default. "Make Linux
  boxes 4 cores by default" can be either: say which you chose. Boxes made
  before keep their size. On the SSH host pool a box has its whole machine,
  so a size only chooses which machine fits it: say so when the pool makes
  the kind.
- **Largest**: `--largest-cores`, `--largest-memory-gib` and
  `--largest-disk-gib` set the most a custom size may ask for.
- **On and off**: `--off` stops offering a kind. The default kind stays
  on: make another the default first, with `--make-default`.
- **Spares**: `--spares 1` keeps a box of the kind ready, enrolled and owned
  by no thread, so a thread has one at once. Each spare holds its memory and,
  on a cloud backend, costs money while it waits.
- **Warm boxes** are per backend: `alia box backend set <id> --warm linux=1`.
  A warm box is started and waiting, but not yet a VesnALIA machine.
- `--reset` goes back to alia-box's own sizes for the kind.

## Options

`alia box option list` shows each option, its value and its default, and
`alia box option get <name>` shows one. Change
several in one save: `alia box option set boxesPerThread=4 enrol=true`.

- **The Monitor**: `alia box option set monitor.enabled=false` turns it off:
  machine status in the sidebar, its sampling, background monitoring and
  its notifications all stop, and its other options keep their values for
  when it is on again. VesnALIA's sidebar shows the change when VesnALIA next loads, so
  tell the person to reload VesnALIA. `alia box doctor`'s Monitor line confirms it.
- **Rebuild each night**: `nightlyImages=true` rebuilds the standard images
  that are due at 03:00 on VesnALIA's server. `alia box setup docker` turns it on.
- **Enrolment**: `enrol=false` keeps boxes from joining VesnALIA as machines.
  Turn it off when boxes cannot reach VesnALIA's server, as in a VesnALIA that listens
  only on localhost.
- **The tailnet**: cloud backends' machines must reach VesnALIA's server. When VesnALIA
  is on a Tailscale tailnet, alia-box joins them to it with an OAuth client.
  The person makes the client as `docs/guide/tailnet.md` says. Ask for its ID
  and secret with `alia secret request`, then save the mode and both secrets
  in one command:

  ```sh
  base64 < "$ALIA_THREAD_STORAGE/alia-box.env" | tr -d '\n' | \
    alia box option set general.tailnet.mode=oauth general.tailnet.tags=tag:alia-box \
      --secret general.tailnet.clientId=TS_CLIENT_ID \
      --secret general.tailnet.clientSecret=TS_CLIENT_SECRET --secrets-stdin
  ```

  `alia box option unset general.tailnet.mode` turns it off. The doctor's
  Tailnet section checks it.

## Images

The standard images are built by each backend's setup, or by alia-box itself
for Docker on a VesnALIA machine and the cloud backends. `alia box images list`
shows their age and what is due, and after them the Linux images each
Namespace backend builds in its own workspace, and each boat.dev backend's
templates. An image whose rebuild failed is skipped until something it is
built from changes, such as the build program after a VesnALIA Box update; `alia box
images build <name>` tries it again at once. Builds retry a package download
only when Ubuntu's archive did not serve it, for at most 10 minutes after
the first failure. A slow download that is still arriving is not stopped.
A failure that says the archive did not serve it for that long is an
outage: build again later. Any other apt error fails at once with apt's
own message, and needs a fix. Scripts that call `apt-get` themselves are
not retried. A check line "first docker command" that says "slow both
times" means Docker was slow at two fresh starts: a busy host, or a delay
in the image. A project's own image, a script run on the
standard image, is in the `alia-box` skill, under "A project's image".

## When it goes wrong

- **Refused with problems**: each problem names its field, such as
  `backends.docker.host`. Fix that field and run the command again. Nothing
  was saved.
- **"The configuration changed since revision n"**: someone else saved
  first. Run `alia box config show` and the command again, without
  `--revision`.
- **"Operation ... was saved at revision n with other changes"**: you used
  an operation ID again for another change. Leave out `--operation`, or give
  a new one.
- **Saved, but its checks failed (exit 2)**: the settings are kept. Fix the
  host as the check's `Fix:` line says, then `alia box backend set <id>
  --check`. Turn the backend off with `--off` if the person wants to finish
  later.
- **"Boxes will not join VesnALIA yet"**, or a box that does not join VesnALIA: boxes
  reach VesnALIA's server through VesnALIA's machine access. Signed in to a VesnALIA account,
  that is VesnALIA connect. Otherwise VesnALIA needs an address boxes can reach, and
  must listen on it (started with `npx alia-app --server-bind-host 0.0.0.0`).
  `alia settings show` shows VesnALIA's settings now. The address is one of this
  machine's own, from `hostname -I`, on VesnALIA's port, that a box can reach.
  Ask the person which, then set both:
  `alia settings general machineServerUrl http://<address>:<port>` and
  `alia settings general defaultMachineAccess direct`. These are VesnALIA's own
  settings, so ask first. Or turn enrolment off with
  `alia box option set enrol=false`: boxes then work, but not as VesnALIA machines.
- **A box fails for a missing image while a build runs**: the image is
  still building. `alia box setup docker` run again says how far it is.
- `alia plugin logs alia-box` says why each box was released, and how long each
  step took.
