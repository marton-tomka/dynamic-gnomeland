import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {createMockTray} from './mock-tray.js';

const out = GLib.getenv('DYNO_TEST_OUTPUT') ?? '/tmp/dyno-icons';
GLib.mkdir_with_parents(out, 0o755);
let passed = 0;
function assert(value, message) {
    if (!value)
        throw new Error(message);
    passed++;
    print(`PASS: ${message}`);
}
async function capture(name) {
    const path = `${out}/${name}.png`;
    const stream = Gio.File.new_for_path(path).replace(null, false, Gio.FileCreateFlags.NONE, null);
    await new Shell.Screenshot().screenshot(false, stream);
    stream.close(null);
    return GdkPixbuf.Pixbuf.new_from_file(path);
}
function pixel(image, actor, u, v) {
    const [x, y] = actor.get_transformed_position();
    const [w, h] = actor.get_transformed_size();
    const offset = Math.floor(y + h * v) * image.rowstride + Math.floor(x + w * u) * image.n_channels;
    return [...image.get_pixels().slice(offset, offset + 3)];
}
function geometry(actor) {
    return JSON.stringify([...actor.get_transformed_position(), ...actor.get_transformed_size()]);
}
function icons(actor) {
    return actor instanceof St.Icon ? [actor] : actor.get_children().flatMap(icons);
}
async function loadExtension(uuid, path) {
    const extension = Main.extensionManager.createExtensionObject(uuid, Gio.File.new_for_path(path), 2);
    await Main.extensionManager.loadExtension(extension);
    Main.extensionManager.enableExtension(uuid);
    await Scripting.sleep(700);
    assert(extension.state === 1, `${uuid} enabled`);
    return extension;
}
export async function run() {
    Main.overview.hide();
    await Scripting.sleep(400);
    const extension = Main.extensionManager.lookup('dyno@local');
    let instance = extension.stateObj;
    instance.disable();
    const dtpPath = '/home/kotsu/.local/share/gnome-shell/extensions/dash-to-panel@jderose9.github.com';
    const source = Gio.SettingsSchemaSource.new_from_directory(`${dtpPath}/schemas`, Gio.SettingsSchemaSource.get_default(), false);
    const dtpSettings = new Gio.Settings({settings_schema: source.lookup('org.gnome.shell.extensions.dash-to-panel', false)});
    dtpSettings.set_string('panel-positions', '{"0":"TOP"}');
    dtpSettings.set_string('panel-sizes', '{"0":30}');
    dtpSettings.set_int('extension-version', 74);
    await loadExtension('dash-to-panel@jderose9.github.com', dtpPath);
    await loadExtension('ubuntu-appindicators@ubuntu.com', '/usr/share/gnome-shell/extensions/ubuntu-appindicators@ubuntu.com');
    instance.enable();
    const settings = extension.stateObj.getSettings();
    const appearance = instance._panelIcons;
    settings.set_boolean('dark-panel-icons', false);
    const background = new St.Widget({style: 'background-color: #f5f1e8;', width: 1280, height: 720});
    Main.uiGroup.insert_child_at_index(background, 0);
    const panelStyle = Main.panel.get_style();
    Main.panel.set_style('background-color: #f5f1e8;');
    const fixture = new St.BoxLayout({style: 'spacing: 10px;'});
    const label = new St.Label({text: '41°C  5%  47%', style: 'color: #ffffff; font-size: 12px;', y_align: Clutter.ActorAlign.CENTER});
    const symbolic = new St.Icon({icon_name: 'audio-volume-high-symbolic', icon_size: 20, style: 'color: #ffffff;'});
    const bitmap = new St.Icon({gicon: new Gio.FileIcon({file: Gio.File.new_for_uri(import.meta.url).get_parent().get_child('fixtures/tray-light.svg')}), icon_size: 32});
    [bitmap, symbolic, label].forEach(actor => fixture.add_child(actor));
    Main.panel._rightBox.insert_child_at_index(fixture, 0);
    await Scripting.sleep(500);
    const bitmapStyle = bitmap.get_style();
    const symbolicStyle = symbolic.get_style();
    const labelStyle = label.get_style();
    const beforeGeometry = geometry(fixture);
    const clockStyle = instance._pillClock.get_style();
    const menuIcon = icons(Main.panel.statusArea.quickSettings.menu.box)[0];
    const menuStyle = menuIcon?.get_style();
    const before = await capture('icons-off');
    assert(!appearance._actors.size, 'disabled mode has no panel actor watchers');
    assert(symbolic.get_is_symbolic() && !bitmap.get_is_symbolic(), 'native icon classification distinguishes symbolic and bitmap artwork');
    settings.set_boolean('dark-panel-icons', true);
    await Scripting.sleep(450);
    print(`Mode state: ${appearance._enabled}; actors=${appearance._actors.size}; label style=${label.get_style()}; colour=${label.get_theme_node().get_foreground_color().to_string()}`);
    const isDark = actor => Math.abs(actor.get_theme_node().get_foreground_color().get_red() - 17 / 255) < 0.001;
    assert(isDark(label), 'status text is dark');
    assert(isDark(symbolic), 'native symbolic icon is dark');
    assert(!symbolic.get_effect('dyno-dark-tray'), 'native symbolic icon needs no shader');
    assert(bitmap.get_effect('dyno-dark-tray'), 'bitmap tray artwork has the detail-preserving effect');
    assert(geometry(fixture) === beforeGeometry, 'icon mode does not change panel geometry');
    assert(instance._pillClock.get_style() === clockStyle, 'Dyno clock is excluded from panel recolouring');
    assert(menuIcon?.get_style() === menuStyle, 'Quick Settings popup retains its own palette');
    const after = await capture('icons-on');
    const whiteBefore = pixel(before, bitmap, 0.3, 0.16);
    const darkAfter = pixel(after, bitmap, 0.3, 0.16);
    print(`Bitmap pixels before=${whiteBefore}; after=${darkAfter}`);
    assert(whiteBefore.every(c => c > 220) && darkAfter.every(c => c < 40), 'white tray pixels become black');
    const hole = pixel(after, bitmap, 0.02, 0.02);
    assert(hole[0] > 220 && hole[1] > 210 && hole[2] > 190, 'transparent holes preserve the light panel background');
    const grey = pixel(after, bitmap, 0.45, 0.45);
    assert(grey[0] > 30 && grey[0] < 180 && Math.abs(grey[0] - grey[1]) < 3,
        'internal grey detail survives inversion');
    label.set_style('color: #339966; font-size: 12px;');
    assert(isDark(label), 'live extension style changes stay dark while mode is active');
    const late = new St.Icon({icon_name: 'network-wired-symbolic', icon_size: 18});
    fixture.add_child(late);
    await Scripting.sleep(130);
    assert(isDark(late), 'newly added status icons follow the enabled mode');
    const trayPath = Gio.File.new_for_uri(import.meta.url).get_parent().get_child('fixtures/tray-light.svg').get_path();
    const tray = await createMockTray(trayPath);
    await Scripting.sleep(1200);
    const status = Object.values(Main.panel.statusArea).find(item => item?._indicator?.id === 'dyno-test-tray');
    assert(status?.icon?.get_effect('dyno-dark-tray'), 'real Ubuntu AppIndicator receives inversion after registration');
    await capture('real-tray-on');
    tray.changeIcon('audio-volume-high-symbolic');
    await Scripting.sleep(600);
    assert(status.icon.get_is_symbolic() && !status.icon.get_effect('dyno-dark-tray'), 'tray switching to a symbolic icon removes inversion');
    Main.panel._rightBox.remove_child(fixture);
    Main.panel._leftBox.add_child(fixture);
    await Scripting.sleep(150);
    assert(bitmap.get_style() === bitmapStyle && !bitmap.get_effect('dyno-dark-tray'), 'moving an icon out of the right side restores it');
    Main.panel._leftBox.remove_child(fixture);
    Main.panel._rightBox.insert_child_at_index(fixture, 0);
    await Scripting.sleep(150);
    settings.set_boolean('dark-panel-icons', false);
    assert(bitmap.get_style() === bitmapStyle && symbolic.get_style() === symbolicStyle, 'toggle off restores original icon styles');
    assert(label.get_style() === 'color: #339966; font-size: 12px;', 'toggle off preserves the latest style supplied by another extension');
    assert(!bitmap.get_effect('dyno-dark-tray') && !appearance._actors.size && !appearance._syncId,
        'toggle off removes effects, watchers, and queued work');
    for (let i = 0; i < 6; i++) {
        settings.set_boolean('dark-panel-icons', true);
        settings.set_boolean('dark-panel-icons', false);
    }
    assert(!appearance._actors.size && !bitmap.get_effect('dyno-dark-tray'), 'repeated toggles leave no owned effects or watchers');
    const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE});
    launcher.setenv('GI_TYPELIB_PATH', `/usr/lib/gnome-shell/girepository-1.0:${GLib.getenv('GI_TYPELIB_PATH') ?? ''}`, true);
    launcher.setenv('LD_LIBRARY_PATH', `/usr/lib/gnome-shell:${GLib.getenv('LD_LIBRARY_PATH') ?? ''}`, true);
    launcher.setenv('GDK_BACKEND', 'wayland', true);
    launcher.setenv('WAYLAND_DISPLAY', 'gnome-shell-test-display', true);
    launcher.setenv('GSK_RENDERER', 'cairo', true);
    const process = launcher.spawnv(['/usr/bin/gjs', '-m', `${Gio.File.new_for_uri(import.meta.url).get_parent().get_path()}/prefs-smoke.js`, extension.path]);
    await Scripting.sleep(1600);
    const preferencesActor = global.get_window_actors().find(actor => actor.meta_window.get_pid() === Number(process.get_identifier()));
    assert(preferencesActor, 'preferences window is managed by the isolated test desktop');
    print(`Preferences window: ${JSON.stringify({class: preferencesActor.meta_window.get_wm_class(),
        rect: preferencesActor.meta_window.get_frame_rect(), visible: preferencesActor.visible, mapped: preferencesActor.mapped,
        opacity: preferencesActor.get_paint_opacity(), workspace: preferencesActor.meta_window.get_workspace()?.index()})}`);
    Main.activateWindow(preferencesActor.meta_window);
    await Scripting.sleep(250);
    const frame = preferencesActor.meta_window.get_frame_rect();
    print(`Preferences frame: ${JSON.stringify({x: frame.x, y: frame.y, width: frame.width, height: frame.height,
        visible: preferencesActor.visible, minimized: preferencesActor.meta_window.minimized})}`);
    await capture('preferences');
    const output = await new Promise((resolve, reject) => process.communicate_utf8_async(null, null, (p, result) => {
        try { resolve(p.communicate_utf8_finish(result)); } catch (error) { reject(error); }
    }));
    print(`Preferences subprocess: ${JSON.stringify(output)}`);
    assert(process.get_successful() && output[1].includes('PREFS:'), 'native preferences switch binds to GSettings in both directions');
    await Scripting.sleep(500);
    assert(settings.get_boolean('dark-panel-icons') && bitmap.get_effect('dyno-dark-tray'), 'preferences toggle reaches the running extension live');
    const paints = {count: 0};
    const paintId = global.stage.connect('after-paint', () => paints.count++);
    await Scripting.sleep(1100);
    global.stage.disconnect(paintId);
    print(`Dark-icon idle paints: ${paints.count}`);
    assert(paints.count < 3 && !appearance._syncId, 'static dark-icon mode has no repaint loop or polling work');
    const saved = bitmapStyle;
    instance.disable();
    assert(bitmap.get_style() === saved && !bitmap.get_effect('dyno-dark-tray'), 'disabling Dyno restores panel icons');
    instance.enable();
    await Scripting.sleep(150);
    assert(bitmap.get_effect('dyno-dark-tray'), 'saved dark-icon preference is applied on re-enable');
    settings.set_boolean('dark-panel-icons', false);
    tray.destroy();
    fixture.destroy();
    instance.disable();
    Main.panel.set_style(panelStyle);
    background.destroy();
    GLib.file_set_contents(`${out}/panel-icons.json`, JSON.stringify({passed, shell: '50.1', realAppIndicator: true, preferences: true, idlePaints: paints.count}, null, 2));
    print(`DYNO PANEL ICONS: ${passed} PASSED`);
}
