Open the screens of the Macs connected to your VesnALIA inside VesnALIA, and use them with your keyboard and
mouse — the Mac running your VesnALIA server and every other Mac enrolled in it, at home or from anywhere
through your getbb.app address.
It is each Mac's own Screen Sharing, drawn in a VesnALIA page; nothing extra is installed on any Mac and no
port is opened to the internet.

## What you get

- A Screen Sharing page in the sidebar, with a Mac picker at the left of its toolbar listing your machines,
  each with whether its Screen Sharing is on, off, not a Mac or offline. When it is off, the page says where in System Settings to turn
  it on.
- Pick a Mac, Connect, sign in with a macOS user name and password, and its screen appears scaled to
  the page.
- Sessions to several Macs at once in the same window; the page shows the one you pick.
- View only, to watch without sending keys or clicks; switch it at any time.
- Send keys, for ⌘Tab, ⌘Space, Mission Control and the other shortcuts your own Mac keeps; Full
  screen, in Chrome, Edge and VesnALIA's desktop app, to give the shared Mac the browser's shortcuts too.
- Clipboard: send your clipboard text to the Mac, copy the Mac's here, or keep both in sync
  automatically, in any language; the choice is remembered for the next connection.
- While any session is open, on any device, the sidebar entry carries a LIVE badge and a pill in the corner of
  every VesnALIA window offers Close all, which ends every session on every Mac.
- Leave the page and come back: the session keeps running in that VesnALIA window and is still signed in.
- Sessions end on Disconnect or Close all, when you close the window, after 30 minutes without
  keyboard or mouse use, and after 8 hours.

## Private by design

The page talks to the VesnALIA server at the same address the VesnALIA app is using: your own Mac, or your
getbb.app address, which only your signed-in VesnALIA account can open. The server reaches its own Mac
directly, and every other Mac through VesnALIA's own encrypted connection to it. Each session needs a
one-time ticket for the Mac you picked that lasts thirty seconds. Your macOS password goes to Screen
Sharing inside its own encrypted sign-in, and VesnALIA never logs or keeps it.

## What it needs

- VesnALIA 0.47 or newer.
- Screen Sharing turned on, on each Mac you want to see, in System Settings → General → Sharing.
  macOS does not let an app turn it on for you.
- Other Macs enrolled in this VesnALIA, with VesnALIA's host daemon connected.
- For use away from home, this VesnALIA signed in to its getbb.app account.

## Limits

- Macs other than the VesnALIA server's go through VesnALIA's link to them, about 0.6 s there and back to a
  laptop away from home: keys and clicks show on screen about half a second later, and the screen
  updates a few times a second.
- A Mac with several displays shows as the one picture macOS sends; you cannot pick a display.
- It is standard VNC, because Apple's faster mode is private to its own app: good for working on a
  Mac, not for watching video.
- The clipboard carries text only, up to 1 MB, and reaches the clipboard of the macOS account VesnALIA runs
  as on that Mac: sign in to Screen Sharing as that account. Safari, Firefox and the mobile app let VesnALIA
  read your clipboard only when you click Send clipboard.
