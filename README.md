# Idlescape - GNOME Video Screensaver

Breathe life into your GNOME desktop. Idlescape is a native GNOME Shell Extension that plays 4K video screensavers using `mpv` whenever you step away.

Optimized for **Wayland**, Idlescape boasts flawless lock-screen integration, zero CPU polling loops, and a resilient process manager that prevents background zombie tasks. 

![GNOME Extensions](https://img.shields.io/badge/GNOME%20Extensions-45%20%7C%2046%20%7C%2047-blue?logo=gnome)
![Wayland Optimized](https://img.shields.io/badge/Wayland-Optimized-success)

## 🌟 Features
* **Zero Polling Loops:** Uses GNOME's native `core_idle_monitor` to safely detect inactivity without eating CPU cycles. 
* **Wayland & Multi-Monitor Safe:** Forces `dmabuf-wayland` playback directly on your primary monitor via mpv.
* **Crash-Proof Process Guards:** Tracks `mpv` PIDs aggressively to guarantee absolutely zero runaway ghost-processes during extension reloads or system lock events.
* **Native Preferences GUI:** Beautiful Libadwaita settings window right inside your GNOME Extensions App. 
* **Micro-Stutter Protection:** Enforces a 1.5-second grace period buffer to prevent flickering from accidental mouse twitches.

## ⚙️ Prerequisites
Idlescape relies on the incredible efficiency of `mpv` to render the video natively. You must have it installed on your system:
```bash
# Arch / Manjaro
sudo pacman -S mpv

# Fedora
sudo dnf install mpv

# Ubuntu / Debian
sudo apt install mpv
```

## 🛠️ Installation & Setup (From Source)
To test and run Idlescape manually from source:

1. **Clone the repository:**
   ```bash
   git clone https://github.com/adhithyants/idlescape.git
   cd idlescape
   ```

2. **Compile the settings schema:**
   GNOME extensions require their settings schemas to be compiled binaries.
   ```bash
   glib-compile-schemas schemas/
   ```

3. **Install the extension:**
   Symlink or copy the directory into your local GNOME shell extensions folder:
   ```bash
   ln -s $(pwd) ~/.local/share/gnome-shell/extensions/idlescape@goku.github.com
   ```

4. **Restart GNOME Shell & Enable:**
   - **X11:** Press `Alt+F2`, type `r`, and hit `Enter`.
   - **Wayland:** Log out and log back in.
   - Open the **GNOME Extensions** app and toggle **Idlescape** ON.

## 🎛️ Configuration
1. Open the GNOME Extensions App.
2. Click the ⚙️ **Settings UI (Gear icon)** next to Idlescape.
3. Configure your preferences: 
   - **Video Path:** Point this to the absolute path of your desired screensaver video (e.g., `/home/user/Videos/relax.mp4`).
   - **Idle Timeout:** Time in seconds before the video triggers.

## 📖 Backend Modes
Idlescape ships with two modes controllable via the Settings GUI:
* **Native (Recommended):** Spawns `mpv` natively via `Gio.Subprocess`, leveraging strict Wayland routines (`--vo=dmabuf-wayland`, `--fs-screen=0`) with auto-fallback to `gpu-next`.
* **Bash (Stable Fallback):** Legacy mode that runs `~/.local/bin/screensaver.sh` if you prefer to manage the environment and `mpv` execution manually.

---
*Built to just work—so your system can relax.*
