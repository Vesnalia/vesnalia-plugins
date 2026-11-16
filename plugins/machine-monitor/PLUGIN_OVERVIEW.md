## What you get

Machine Monitor adds a Machine status panel to the sidebar footer. Pick any of your VesnALIA machines, including the VesnALIA server and VesnALIA Box boxes, and see its CPU, GPU, memory, free space, network, battery, Tailscale details and top processes. Apple silicon Macs also show CPU and GPU temperature and power. Hover a section for more detail. The panel reads data only while it is open.

`alia machine-monitor snapshot` prints the VesnALIA server's numbers in a terminal. `alia machine-monitor health` reports pressure and exits 2 when a reading is critical.

Turn on background monitoring to check the VesnALIA server's CPU and memory every 30 seconds while the panel is closed. Sustained overload shows an in-app alert while VesnALIA is open and visible.

## How it works

Each machine is read by the plugin's host entry, which VesnALIA runs on that machine. It reads system counters only. It never calls an outside service, and it does not change settings, enable swap or kill processes.

## Requirements

Needs VesnALIA 0.46 or newer. Works on Linux, macOS and WSL. Temperature, power and GPU usage need an Apple silicon Mac. No account, API key or extra install.

Based on Beacon by g4f4r0.
