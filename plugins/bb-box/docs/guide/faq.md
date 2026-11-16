# Common questions

Short answers to common questions about VesnALIA Box. Each answer links to the page that has the detail.

## Is a box a security boundary?

No. VesnALIA Box assumes one trusted user, and it is not a sandbox for code you do not trust. How far a box is kept apart depends on its backend. A Docker box is a privileged container by default, which can take over its Docker host. A box on an SSH host pool machine is an ordinary user there, and can read every file that user has permission to read. A shared iOS box is a macOS user of its own on a Mac it shares with other boxes.

Give boxes only machines that hold nothing you would not show them. Turn off **Docker in boxes**, or use rootless Docker, and Docker boxes run unprivileged, without Docker of their own. See [the Docker settings](../reference/configuration.md#docker) and [the SSH host pool](../../setup/ssh-pool/README.md).

## How does VesnALIA Box handle keys and tokens?

VesnALIA Box keeps backend secrets, such as API tokens and SSH keys, apart from its settings. Settings and exports show only whether each one is set, never its value. VesnALIA Box uses each secret to sign in to the service it is for. See [secrets](../reference/configuration.md#secrets).

Commands in a box that joins VesnALIA can get Git credentials and variables through VesnALIA, and a project's variables only while a thread of that project runs there. A box that does not join gets neither through VesnALIA. See [when a box does not join VesnALIA](boxes.md#when-a-box-does-not-join-alia).

For cloud machines on a tailnet, VesnALIA Box makes a single-use key for each machine from a Tailscale OAuth client. See [Network](settings.md#network). A fork gives up its source's VesnALIA credentials, and VesnALIA Box checks they are gone before it hands the fork over. Other secrets on the disk stay. See [a copy of a box gives up its identity](snapshots.md#a-copy-of-a-box-gives-up-its-identity).

## What stops a cloud bill running away?

Each cloud backend has a limit on what it runs at once, 2 by default: **Most hosts** on Hetzner Cloud, **Most machines** on Namespace and **Most boxes** on boat.dev. Each Namespace workspace can be a backend of its own, with its own Most machines, and each boat.dev account with its own Most boxes: see [several workspaces](namespace.md#several-workspaces) and [several accounts](boat.md#several-accounts). Hetzner Cloud's **Monthly limit (EUR)**, 20 by default before VAT, stops VesnALIA Box making new hosts, but a busy host keeps running past it. Hetzner has no limit of its own, so set a cost alert in its Console too. While VesnALIA Box runs, it deletes a Hetzner host that has had no box for its **Idle minutes**, 30 by default. See [keeping the cost down on Hetzner Cloud](hetzner.md#keeping-the-cost-down).

On Namespace and boat.dev, VesnALIA Box keeps renewing a deadline on each machine. If VesnALIA Box stops, a boat.dev box stops after its **Auto-stop (minutes)**, 30 by default, and a Namespace machine ends within the hour. A Hetzner host has no such deadline: if VesnALIA Box stops for good, delete its hosts yourself. See [the auto-stop on boat.dev](boat.md#stop-start-and-the-auto-stop) and [checking that nothing is left running on Namespace](namespace.md#check-that-nothing-is-left-running).

Spares back off when they fail. If a device spare has not booted 10 minutes after it was ready, VesnALIA Box makes no spares of its kind for 30 minutes. If a project image's spare fails to start, VesnALIA Box makes no spares of that build for a day. See [spares of device boxes](spares.md#spares-of-device-boxes) and [checks](../reference/checks.md).

## How long does a box last?

A box belongs to a thread, and lasts until you release it or its thread is archived or deleted. A machine is a box of your own that belongs to no thread, and lasts until you remove it. On Namespace, either ends sooner, at your plan's limit on how long a machine can live. See [the user guide](README.md), [your machines](boxes.md#your-machines) and [what your plan allows on Namespace](namespace.md#what-your-plan-allows).

Releasing a box on a virtual machine or container deletes its disk. Releasing a box on an SSH host pool machine removes its box user and that user's home, or resets the whole machine where you set that up, then lends the machine again: it does not wipe the disk. Copy out what you want to keep first, or keep a snapshot, which outlasts its box until its keep date. See [releasing a box](boxes.md#releasing-a-box) and [keeping a snapshot](snapshots.md#keeping-a-snapshot).

## Do I need hardware of my own?

No. Hetzner Cloud, Namespace and boat.dev each make boxes with no machine of your own. Their machines reach VesnALIA's server through VesnALIA connect or [the tailnet](tailnet.md). With several backends turned on, **First with room** tries them in order and uses the first with room for the box. See [choose a backend](../../setup/README.md#choose-a-backend) and [Provider](making-a-box.md#provider).

## Which backend should I start with?

Docker on Linux, microsandbox on a Mac with Apple silicon, and Docker in WSL 2 on Windows. Each runs boxes on the machine that runs VesnALIA. See [the quick start](../../README.md#quick-start) for what each needs, such as disk space.

## Which systems can boxes run?

| System | Backends |
| --- | --- |
| Linux on x86_64 | Docker, microsandbox, Proxmox LXC, Proxmox QEMU, SSH host pool, Hetzner Cloud, Namespace, boat.dev |
| Linux on arm64 | Tart, microsandbox, Hetzner Cloud |
| Linux desktop on x86_64 | Docker, microsandbox, Proxmox LXC, Proxmox QEMU, Hetzner Cloud, Namespace, boat.dev |
| Linux desktop on arm64 | Tart, microsandbox, Hetzner Cloud |
| Linux desktop on a GPU | Docker, Proxmox LXC |
| macOS, with or without a desktop | Tart, SSH host pool, Namespace |
| Windows desktop | Proxmox QEMU, and Tart on arm64 |
| iPhone and iPad in the iOS Simulator | Tart, SSH host pool, Namespace |
| Android emulator | Proxmox QEMU, boat.dev |

See [kinds and sizes](../reference/kinds.md) and [backends and boxes](../../README.md#backends-and-boxes).

## What does it cost?

VesnALIA Box is under the MIT licence. On machines of your own, you pay for the hardware, its power and any software that needs a licence. Cloud backends bill your own account with each provider, and charges can include running machines, image builds, storage and starts. Hetzner Cloud bills VesnALIA Box's host images even when no box runs, and boat.dev bills saved snapshots and starts beyond what your plan includes. See what it costs on [Hetzner Cloud](hetzner.md#what-it-costs), [Namespace](namespace.md#what-it-costs), [boat.dev](boat.md#what-it-costs) and [a cloud server as a Docker host](cloud-docker-host.md#what-it-costs).

## Why does a box say Could not join VesnALIA?

The box could not reach VesnALIA's server or finish joining it: its page says why. If VesnALIA says to sign in to your VesnALIA account, do so, so VesnALIA connect can reach VesnALIA. Or set Machine access to **Manual** with an address boxes can reach, and start VesnALIA listening there, which makes VesnALIA reachable by anything else on that network too. VesnALIA Box retries network and DNS failures by itself, and **Join VesnALIA again** on the box's page tries at once. See [when a box does not join VesnALIA](boxes.md#when-a-box-does-not-join-alia).
