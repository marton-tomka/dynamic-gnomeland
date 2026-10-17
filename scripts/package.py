#!/usr/bin/env python3
"""Build the dependency-free GNOME extension archive."""
from pathlib import Path
import subprocess
from zipfile import ZIP_DEFLATED, ZipFile

project = Path(__file__).resolve().parent.parent
subprocess.run(['glib-compile-schemas', '--strict', str(project / 'schemas')], check=True)
destination = project / 'dist'
destination.mkdir(exist_ok=True)
archive = destination / 'dyno@local.shell-extension.zip'
with ZipFile(archive, 'w', compression=ZIP_DEFLATED) as output:
    for name in ('metadata.json', 'extension.js', 'island.js', 'media.js', 'search.js', 'notifications.js', 'waveform.js', 'workspaces.js', 'panelIcons.js', 'prefs.js', 'stylesheet.css', 'schemas/org.gnome.shell.extensions.dyno.gschema.xml', 'schemas/gschemas.compiled'):
        output.write(project / name, name)
print(archive)
