# Tart

Tart runs VMs on Macs with Apple silicon: `macos`, `macos-desktop`, `ios`,
`linux-arm64`, `linux-arm64-desktop-cpu` and `windows-arm64-desktop`. Each
Mac is a host of the backend. The guide is `setup/tart/README.md`.

Apple's licence allows two macOS VMs per Mac, so a Mac holds at most two
macOS or iOS boxes at once. Tart is under the FSL licence: internal use is
fine; offering VMs to others as a service may not be. Say both to the person
when they plan more than their own use.

## Ask

- Each Mac's address, an administrator who may run `sudo` there, and its
  macOS version. A VM's macOS must be no newer than the Mac's.
- Which kinds: macOS needs about 80 GiB of disk for the image with Xcode, and
  each box its memory, 8 GiB at the small preset.
- Whether the Mac is set aside for boxes, and may stay awake
  (`sudo pmset -a sleep 0`).
- VesnALIA's server URL, for `--alia-url`, so boxes join VesnALIA faster.

## Prepare each Mac

1. As an administrator on the Mac, make alia-box's user and turn on Remote
   Login for it:

   ```sh
   sudo sysadminctl -addUser bbbox-admin -fullName "alia-box" -password -
   sudo dseditgroup -o edit -a bbbox-admin -t user com.apple.access_ssh
   sudo systemsetup -setremotelogin on
   ```

   The `-password -` prompts for a password. The person types it; do not
   choose one for them.
2. As `bbbox-admin`, install Tart: `brew install openai/tools/tart`.
3. Add the backend off, and get alia-box's public key from its checks:

   ```sh
   alia box backend add tart --off
   alia box backend set tart --check     # a note gives the public key, ssh-ed25519 ...
   ```

   Add that key to `bbbox-admin`'s `~/.ssh/authorized_keys` on the Mac.
4. Copy `setup/tart` from a checkout of alia-box at the installed commit to the
   Mac, and as `bbbox-admin` build the images you want:

   ```sh
   tart pull ghcr.io/cirruslabs/macos-golden-gate-xcode:27     # about 69 GB
   ./prepare-image.sh --key 'ssh-ed25519 AAAA... alia-box' --alia-url https://bb.example.com
   ./prepare-ios-image.sh                                      # about 17 minutes, for ios
   ./prepare-linux-image.sh --key 'ssh-ed25519 AAAA... alia-box'  # for linux-arm64
   ```

   Each leaves a stopped image, such as `alia-box-macos`, and its record, which
   the doctor reads. Use the macOS image the Mac's macOS can run: the guide
   lists the `--from` choices.

## Add each Mac and turn it on

```sh
ssh-keyscan -t ed25519 192.0.2.20 > "$ALIA_THREAD_STORAGE/mac-1.keys"
alia box backend host add tart mac-1 --field address=192.0.2.20 \
  --field user=bbbox-admin --field-file host-keys="$ALIA_THREAD_STORAGE/mac-1.keys"
alia box backend set tart --field ios-image=alia-box-ios --on --check
alia box backend set tart --field ios-image=alia-box-ios --on
```

`--field-file` is read on the machine VesnALIA's server runs on. If your thread
runs elsewhere, give the key line itself:
`--field host-keys="192.0.2.20 ssh-ed25519 AAAA..."`. Host keys are not
secret.

- `macos-image` and `macos-desktop-image` default to `alia-box-macos`. The
  other images are empty by default, which keeps their kinds off. Set
  `linux-image=alia-box-linux` and `ios-image=alia-box-ios` once they are built.
- `ios-hosts-on=true` shares iOS VMs between ios boxes: each box is a macOS
  user on a shared VM, ready in seconds. Off, each ios box is a VM of its
  own.
- `alia box backend host set tart mac-1 --off` stops new boxes on a Mac; its
  boxes keep working. A Mac's own sizes for its shared iOS hosts are host
  fields: `ios-hosts-most`, `ios-hosts-cores`, `ios-hosts-memory-gib`.
- `--warm macos=1` keeps a suspended VM ready on a Mac set aside for boxes.
  On a Mac people also use, it takes a VM slot and disk; leave it at 0.

## Check and prove

`alia box doctor` checks each Mac, its Tart, its images and their records, and
the room. Prove it with `alia box acquire macos --on tart`, which takes about a
minute from a stopped image, or seconds from a warm one. Release it at once:
it holds one of the Mac's two VMs.
