# Joining cloud machines to your tailnet

VesnALIA Box can rent machines for your boxes, such as Macs from Namespace or servers from Hetzner Cloud. Each machine, and each box on it, must reach your VesnALIA server. If your VesnALIA server is on a Tailscale tailnet, each machine joins the tailnet as it starts and leaves it when its box goes. This page sets that up.

You do this once. It takes about 10 minutes, in two places: Tailscale's admin console, and VesnALIA Box's settings.

## Before you start

You need:

- to be an Owner, Admin, Network admin or IT admin of the tailnet in Tailscale
- VesnALIA Box installed, with its settings open in VesnALIA

If your VesnALIA server is not on a tailnet, you do not need any of this: see [when VesnALIA is not on a tailnet](#when-alia-is-not-on-a-tailnet).

## How it works

You give VesnALIA Box a Tailscale OAuth client. For each machine it starts, VesnALIA Box uses the client to make a key that:

- works once, for that one machine
- expires after 10 minutes if it is not used
- joins the machine already approved, so nobody has to approve it
- marks the machine with a tag, `tag:alia-box`, so your tailnet policy decides what it may reach
- makes the machine ephemeral, so Tailscale removes it soon after it goes offline

The key reaches the machine over an encrypted connection. It is never written in a log or shown on a page. When the box is released, the machine logs out of the tailnet before it is deleted.

## 1. Add the tag to your tailnet policy

In Tailscale's admin console, go to **Access controls**. In the policy file, add `tag:alia-box` under `tagOwners`, owned by your admins:

```json
"tagOwners": {
  "tag:alia-box": ["autogroup:admin"],
},
```

If `tagOwners` is already there, add only the `"tag:alia-box"` line to it.

If your policy is still Tailscale's default, which lets every device reach every other, it needs no rule. If you have written your own rules, add two:

1. `tag:alia-box` reaches the device that VesnALIA's URL points at, on port 443.
2. The machine VesnALIA's server runs on reaches `tag:alia-box` on port 22. VesnALIA Box uses this to reach its cloud machines over SSH, such as the Docker hosts the Hetzner backend makes.

These can be 2 different devices. VesnALIA's URL may point at a reverse proxy rather than at the machine VesnALIA's server runs on. To find the device VesnALIA's URL points at, look up the address its name has, for example with `dig +short` followed by the name. Then find that address in `tailscale status`, or under **Machines** in the admin console.

In the visual policy editor, these are 2 rules under **General access rules**. Select **Add rule** for each:

| Rule | Source | Destination | Port and protocol |
| --- | --- | --- | --- |
| 1 | `tag:alia-box` | the device VesnALIA's URL points at | `tcp:443` |
| 2 | the machine VesnALIA's server runs on | `tag:alia-box` | `tcp:22` |

Select **Save**.

## 2. Make the OAuth client

Still in the admin console, go to **Settings**, then **Trust credentials**.

1. Select **Credential**, then **OAuth**.
2. Choose these two operations, each with **Write**, and give each the tag `tag:alia-box`:
   - the `auth_keys` operation, under Keys: VesnALIA Box makes the key for each machine with it.
   - the `devices:core` operation, under Devices: VesnALIA Box finds and removes the devices of machines that went without logging out.
3. Add a description, such as "VesnALIA Box".
4. Select **Generate credential**.

Tailscale shows the client's ID and its secret. Keep the page open: the secret is shown only once.

## 3. Enter it in VesnALIA Box

In VesnALIA, open VesnALIA Box's settings, and under **Options** select **Network**.

1. For **Join machines to the tailnet**, choose **Yes, with a Tailscale OAuth client**.
2. Leave **Tags** empty, for `tag:alia-box`, unless you chose another tag in step 1.
3. Select **Set** beside **OAuth client ID** and paste the client's ID. Do the same for **OAuth client secret**.
4. Select **Save**.

The fields then show **Set**. VesnALIA Box never shows them again. You can now close Tailscale's page.

## 4. Check it

In a terminal on a computer with VesnALIA, run:

```sh
alia box doctor
```

Under **Tailnet**, the doctor should say:

- **OAuth client**: Tailscale signs the client in, with the tags machines join with.
- **Devices**: VesnALIA Box's own machines on the tailnet, by name. This is none until VesnALIA Box starts a machine. If other devices have the tag too, it says how many, without naming them.

If **OAuth client** fails, check the ID and secret, and that the client has the `auth_keys` operation with the tag. If **Devices** warns, give the client the `devices:core` operation too.

## Machines you joined by hand

A machine you joined to the tailnet yourself, with `tailscale up` and a login link, as you might while trying a provider out, is not ephemeral. It stays in the tailnet after it logs out or is deleted, and VesnALIA Box does not remove it, as it did not name it. Remove it yourself, under **Machines** in the admin console.

## Using a tag you already have

**Tags** takes any tags the OAuth client may use, such as one your tailnet has already. Before you use one, know what that means:

- VesnALIA Box's machines get everything the tag reaches in your policy. If the tag reaches your own computers, so do the cloud machines, and so does anyone who uses a box.
- With `devices:core` on that tag, the client can remove any device that has it, your own included. VesnALIA Box itself only removes devices whose names it gave them: names that start with `alia-box-`, `alia-box-hz-` or `alia-box-ns-`, then its install's ID. But whoever holds the client's secret could remove the rest.

So a tag of VesnALIA Box's own, `tag:alia-box`, is the safer choice. Reuse a tag only if every device that has it is meant to be reached by VesnALIA Box's machines, and you are content for the client to be able to remove those devices.

## Replacing or revoking the client

To replace the client, make a new one as in step 2, enter it as in step 3, and then revoke the old one.

To revoke a client, go to **Settings**, then **Trust credentials**, in Tailscale's admin console, and revoke it there. Then:

- VesnALIA Box cannot make keys any more, so new cloud machines cannot join the tailnet, and their boxes fail to start with the reason. The doctor says so.
- Machines that already joined stay on the tailnet, as their keys were used when they joined. They leave when their boxes are released, as before.
- Until you enter a new client, VesnALIA Box cannot remove the devices of machines that went without logging out. Tailscale still removes them, as they are ephemeral.

## When VesnALIA is not on a tailnet

If your VesnALIA server is reached through VesnALIA connect, or at a public address, machines do not need to join a tailnet. On the **Network** page of VesnALIA Box's settings, choose **No: VesnALIA is reached without one**, and select **Save**. This deletes a client you entered before.

## When VesnALIA Box suggests the tailnet

When a box cannot join VesnALIA, VesnALIA Box suggests the tailnet only when reaching VesnALIA really fails: when no box on the backend reaches VesnALIA after 5 tries, or when every box there is refused or has no route to VesnALIA. A single failure that can pass, such as a DNS lookup of VesnALIA's server that timed out, gets no such advice: VesnALIA Box tries again by itself. See [When a box does not join VesnALIA](boxes.md#when-a-box-does-not-join-alia).

## Next

Set up the cloud machines themselves: [Linux boxes on Hetzner Cloud](hetzner.md), [Mac and Linux boxes on Namespace](namespace.md), or [a cloud server as a Docker host](cloud-docker-host.md).
