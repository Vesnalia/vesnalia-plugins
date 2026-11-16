# VesnALIA plugin — Web Push Notify

Get Web Push notifications when a VesnALIA agent finishes or fails—even when VesnALIA is
closed. Notifications are sent directly from your VesnALIA server, with no polling
or hosted backend.

![Web Push Notify settings](https://5kas5z928t.ufs.sh/f/wBHVA4PQTleA3WY1UxLkR1By5XqrOpEFLJHDQUGMlZTmaVsw)

![VesnALIA browser notification](https://5kas5z928t.ufs.sh/f/wBHVA4PQTleAqY552STUnWzO4bXIPRq9Aj61d8FEVhBvgDLu)

## Install

Requires VesnALIA 0.36 or newer and an HTTPS or localhost VesnALIA origin.

```sh
alia plugin install git:https://github.com/MayankBansal12/bb-plugin-web-push-notify.git@main --yes
```

Open **Settings → Extensions → Plugins → Web Push Notify**, name the browser,
then allow notifications and select **Enable and test**.

## Security and backups

VesnALIA stores this plugin's VAPID private key and browser push subscriptions in
the plugin database under VesnALIA's data directory. Treat that database, its WAL
files, and backups as credentials: restrict host and backup access to the VesnALIA
operator. Anyone who obtains both the private key and subscription records can
send notifications that appear to come from this VesnALIA server.

Removing and reinstalling the plugin may rotate the VAPID key and require
browsers to register again. Restores should keep the plugin database and its
WAL files together.

## Develop

```sh
git clone https://github.com/MayankBansal12/bb-plugin-web-push-notify.git
cd alia-plugin-web-push-notify
npm install
npm run typecheck
npm test
npm run build
alia plugin install . --yes
alia plugin dev
```

## Contributions

Issues and pull requests are welcome.
