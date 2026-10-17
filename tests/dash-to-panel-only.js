import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

export async function run() {
    Main.overview.hide();
    await Scripting.sleep(400);
    if (Main.extensionManager.lookup('dyno@local'))
        throw new Error('This probe must run without Dyno installed');
    const uuid = 'dash-to-panel@jderose9.github.com';
    const dir = Gio.File.new_for_path(`/home/kotsu/.local/share/gnome-shell/extensions/${uuid}`);
    const schemaSource = Gio.SettingsSchemaSource.new_from_directory(`${dir.get_path()}/schemas`, Gio.SettingsSchemaSource.get_default(), false);
    const settings = new Gio.Settings({settings_schema: schemaSource.lookup('org.gnome.shell.extensions.dash-to-panel', false)});
    settings.set_string('panel-positions', '{"0":"TOP"}');
    settings.set_string('panel-sizes', '{"0":30}');
    settings.set_int('extension-version', 74);
    settings.set_string('panel-element-positions', JSON.stringify({'0': [
        {element: 'showAppsButton', visible: false, position: 'stackedTL'},
        {element: 'activitiesButton', visible: false, position: 'stackedTL'},
        {element: 'leftBox', visible: true, position: 'stackedTL'},
        {element: 'taskbar', visible: true, position: 'stackedTL'},
        {element: 'dateMenu', visible: true, position: 'centerMonitor'},
        {element: 'centerBox', visible: true, position: 'stackedBR'},
        {element: 'rightBox', visible: true, position: 'stackedBR'},
        {element: 'systemMenu', visible: true, position: 'stackedBR'},
        {element: 'desktopButton', visible: false, position: 'stackedBR'},
    ]}));
    const dtp = Main.extensionManager.createExtensionObject(uuid, dir, 2);
    await Main.extensionManager.loadExtension(dtp);
    Main.extensionManager.enableExtension(uuid);
    await Scripting.sleep(900);
    if (dtp.state !== 1)
        throw new Error(`Dash to Panel failed: ${dtp.error}`);
    print('DTP-ONLY: enabled; Dyno absent');
    Main.overview.show();
    await Scripting.sleep(400);
    Main.overview.hide();
    await Scripting.sleep(22000);
    print('DTP-ONLY: complete');
}
