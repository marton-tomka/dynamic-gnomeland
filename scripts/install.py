#!/usr/bin/env python3
"""Install Dyno or restore the previous MediaLine choice without changing other extensions."""
import argparse
import json
import os
from pathlib import Path
import subprocess
from gi.repository import Gio

PROJECT = Path(__file__).resolve().parent.parent
UUID = 'dyno@local'
MEDIA = 'medialine@funinkina.co.in'
STATE = PROJECT / '.install-state.json'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--restore', action='store_true', help='disable Dyno and restore the saved MediaLine enabled state')
args = parser.parse_args()
settings = Gio.Settings.new('org.gnome.shell')
enabled = list(settings.get_strv('enabled-extensions'))
disabled = list(settings.get_strv('disabled-extensions'))
others_enabled = [item for item in enabled if item not in (UUID, MEDIA)]
others_disabled = [item for item in disabled if item not in (UUID, MEDIA)]

if args.restore:
    if not STATE.exists():
        raise SystemExit('No installation state exists; nothing changed.')
    saved = json.loads(STATE.read_text())
    enabled = [item for item in enabled if item != UUID]
    if UUID not in disabled:
        disabled.append(UUID)
    if saved['medialine_enabled']:
        if MEDIA not in enabled:
            enabled.append(MEDIA)
        disabled = [item for item in disabled if item != MEDIA]
    else:
        enabled = [item for item in enabled if item != MEDIA]
        if saved['medialine_disabled'] and MEDIA not in disabled:
            disabled.append(MEDIA)
else:
    subprocess.run(['python3', str(PROJECT / 'scripts/package.py')], check=True)
    if not STATE.exists():
        STATE.write_text(json.dumps({
            'medialine_enabled': MEDIA in enabled,
            'medialine_disabled': MEDIA in disabled,
            'enabled_extensions_before': enabled,
            'disabled_extensions_before': disabled,
        }, indent=2) + '\n')
    subprocess.run(['gnome-extensions', 'install', '--force', str(PROJECT / 'dist' / f'{UUID}.shell-extension.zip')], check=True)
    enabled = [item for item in enabled if item != MEDIA]
    if UUID not in enabled:
        enabled.append(UUID)
    disabled = [item for item in disabled if item != UUID]
    if MEDIA not in disabled:
        disabled.append(MEDIA)

assert [item for item in enabled if item not in (UUID, MEDIA)] == others_enabled
assert [item for item in disabled if item not in (UUID, MEDIA)] == others_disabled
settings.set_strv('disabled-extensions', disabled)
settings.set_strv('enabled-extensions', enabled)
Gio.Settings.sync()
if list(settings.get_strv('enabled-extensions')) != enabled or list(settings.get_strv('disabled-extensions')) != disabled:
    raise SystemExit('GNOME did not accept the requested extension selections; inspect the current settings before continuing.')
print('Other extension selections preserved.')
if args.restore:
    print('Dyno disabled; the saved MediaLine selection restored. Source and installed files retained.')
else:
    result = subprocess.run(['gnome-extensions', 'info', UUID], text=True, capture_output=True,
                            env={**os.environ, 'LC_ALL': 'C'})
    print(result.stdout.strip() or 'Dyno installed and selected for the next GNOME session.')
    print('Sign out and back in to load this JavaScript build. A running extension may still be the previous version. Do not restart GNOME Shell on Wayland.')
