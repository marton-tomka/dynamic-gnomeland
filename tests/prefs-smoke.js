import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio.resources_register(Gio.Resource.load('/usr/share/gnome-shell/org.gnome.Shell.Extensions.src.gresource'));
Adw.init();
const directory = Gio.File.new_for_path(ARGV[0]);
const [, data] = directory.get_child('metadata.json').load_contents(null);
const metadata = {...JSON.parse(new TextDecoder().decode(data)), dir: directory, path: ARGV[0]};
const {default: Preferences} = await import(directory.get_child('prefs.js').get_uri());
const application = new Adw.Application({application_id: 'org.gnome.Shell.Extensions.DynoTest', flags: Gio.ApplicationFlags.NON_UNIQUE});
application.register(null);
const window = new Adw.PreferencesWindow({application, title: 'Dyno'});
new Preferences(metadata).fillPreferencesWindow(window);
function findSwitch(widget) {
    if (widget instanceof Adw.SwitchRow)
        return widget;
    for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) {
        const result = findSwitch(child);
        if (result)
            return result;
    }
    return null;
}
const row = findSwitch(window);
if (!row || row.title !== 'Dark panel icons')
    throw new Error('Dark panel icons switch is missing');
row.active = true;
if (!window._settings.get_boolean('dark-panel-icons'))
    throw new Error('Preferences switch did not write settings');
window._settings.set_boolean('dark-panel-icons', false);
if (row.active)
    throw new Error('Preferences switch did not follow settings');
row.active = true;
Gio.Settings.sync();
window.present();
print('PREFS: switch and GSettings binding passed');
const loop = new GLib.MainLoop(null, false);
GLib.timeout_add_once(GLib.PRIORITY_DEFAULT, 3000, () => { window.close(); loop.quit(); });
loop.run();
