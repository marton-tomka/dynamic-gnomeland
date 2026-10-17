# Dyno

A GNOME Shell extension for Wayland that blends the iPhone’s Dynamic Island with the clean functionality of the macOS top-bar, bringing everyday controls together with smooth, satisfying animations.

**GNOME 50 · Wayland · Tested on Ubuntu 26.04**

[Latest release](https://github.com/marton-tomka/dynamic-gnomeland/releases/latest) · [Installation](#installation) · [Features](#features) · [Feedback](https://github.com/marton-tomka/dynamic-gnomeland/issues)



## Demo

https://github.com/user-attachments/assets/9eec6bcd-d341-4199-8013-ab0531db08b6

[Achieve the exact demo state](demo/stuff.md)



## Installation

### Latest release

1. Download **`dyno@local.shell-extension.zip`** from the [latest release](https://github.com/marton-tomka/dynamic-gnomeland/releases/latest).
2. Install it:

   ```sh
   gnome-extensions install --force ~/Downloads/dyno@local.shell-extension.zip
   ```

3. **Sign out and back in** to load the extension or an updated build.
4. Enable **Dyno** in the Extensions app, or run:

   ```sh
   gnome-extensions enable dyno@local
   ```

### From source

```sh
git clone https://github.com/marton-tomka/dynamic-gnomeland.git
cd dynamic-gnomeland
python3 scripts/install.py
```

Then sign out and back in. The installer builds the ZIP, enables Dyno, and disables MediaLine if present. It saves the previous MediaLine choice so it can be restored later. Other extension selections are preserved.

Building from source needs Python 3, PyGObject, and `glib-compile-schemas`, alongside GNOME’s `gnome-extensions` command.



## Features

- **An island around your clock.** A compact day-and-time display expands around a clock that stays visible throughout. Empty side space collapses when idle.
- **Media above search.** See what’s playing with artwork, play/pause, previous/next, player switching, and a shortcut back to the app. Works with apps and browsers that expose system media controls.
- **Playback that feels alive.** An animated waveform settles into flat dots when paused, with a subtle pink glow when playback starts or the track changes.
- **GNOME search, within reach.** Search apps, files, and actions through your enabled GNOME search providers.
- **Notifications in the island.** Incoming banners expand inside it, keeping their actions, sound, and Do Not Disturb behaviour. The bell opens your notification centre.
- **Calendar and agenda.** Open GNOME’s calendar from the calendar button, without making it the default view.
- **Screenshot feedback.** A camera icon and teal glow confirm a native GNOME screenshot. The shutter sound stays; the duplicate success notification is suppressed.
- **Workspace feedback.** The compact clock briefly becomes “Workspace 2”, then returns to the time. GNOME’s desktop slide and touchpad gestures stay; its bottom workspace indicator moves into the island.
- **Dark panel icons.** A live setting for light wallpapers darkens the right-side icons and text, including third-party tray artwork, while preserving its detail.
- **Smooth, keyboard-friendly interaction.** Native animations, subtle event glows, mouse/keyboard parity, and support for GNOME’s reduced-motion setting.

## Controls

| Input | Action |
| --- | --- |
| Click the island / first **Super** | Open media and search |
| Second **Super** | Window overview |
| Third **Super** | All apps grid |
| Fourth **Super** | Return to the desktop |
| **↑** from search | Playback controls |
| **← / →** | Move between playback controls |
| **↓** | Return to search or move into results |
| **Enter** | Activate the selected control or result |
| **Tab / Shift+Tab** | Move between controls |
| **Esc** | Go back, then close |
| Click outside | Close the island |

## Settings and styling

Open **Extensions → Dyno → Settings**, or run:

```sh
gnome-extensions prefs dyno@local
```

Enable **Dark panel icons** when using a light wallpaper. It applies immediately and is remembered across sessions. Third-party tray artwork uses greyscale inversion to retain its edges and shading.

Dyno works with **Dash to Panel** and **Ubuntu AppIndicators**. For the floating look in the demo, use your theme, Dash to Panel, or Blur my Shell settings to adjust the panel background.

**More thorough customization options and a fuller settings panel are coming later.** For now, most layout and animation choices are fixed.

## Compatibility

Dyno currently targets **GNOME Shell 50 on Wayland**. It has been tested on Ubuntu 26.04, including a top-mounted Dash to Panel. It requires GNOME Shell; it isn’t a standalone bar for other Wayland compositors.

Media controls depend on the app’s system media support. Screenshot confirmation covers GNOME’s screenshot tool. Extensions that replace the clock, notification tray, or overview may need to be disabled if they conflict with Dyno.

## Disable or remove

Turn Dyno off in Extensions, or run:

```sh
gnome-extensions disable dyno@local
```

This restores the native clock, notification presentation, and workspace indicator. To uninstall it:

```sh
gnome-extensions uninstall dyno@local
```

If you used the source installer, `python3 scripts/install.py --restore` disables Dyno and restores the saved MediaLine selection.



## Feedback

Bug reports, rice screenshots, and ideas are welcome in [Issues](https://github.com/marton-tomka/dynamic-gnomeland/issues). For a bug, include your GNOME version, distro, relevant extensions, and steps to reproduce it.

## AI note

Dyno was built entirely with **GPT-6 Astra** and **GPT-6.1 Sol**, with human direction/design and testing.

## License

[MIT](LICENSE) © Marton Tomka.
