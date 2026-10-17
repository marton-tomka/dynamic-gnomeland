import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
    print(`PASS: ${message}`);
}

export async function run() {
    Main.overview.hide();
    await Scripting.sleep(500);
    const extension = Main.extensionManager.lookup('dyno@local');
    print(`Dyno state: ${extension?.state}; errors: ${JSON.stringify(extension?.errors)}`);
    assert(extension?.stateObj?._surface, 'extension enabled');
    const instance = extension.stateObj;
    const surface = instance._surface;
    surface.open();
    await Scripting.sleep(400);
    assert(surface.isOpen && surface.page === 'home', 'opens on activity and search');
    assert(global.stage.get_key_focus() === surface.entry.clutter_text, 'search receives initial focus');
    print(`Geometry: ${surface.actor.width}×${surface.actor.height}; content: ${surface.content.width}×${surface.content.height}`);
    surface.showPage('calendar');
    await Scripting.sleep(250);
    assert(surface._borrowed?.actor.contains(Main.panel.statusArea.dateMenu._calendar), 'native calendar reachable');
    surface.showPage('notifications');
    await Scripting.sleep(250);
    assert(surface._borrowed?.actor === Main.panel.statusArea.dateMenu._messageList, 'native notifications reachable');
    surface.showPage('home');
    assert(!surface._borrowed, 'native components returned to original parents');
    surface.entry.set_text('settings');
    await Scripting.sleep(800);
    assert(surface.search.results.length > 0, 'application search returns results');
    surface.close(false);
    assert(!surface.isOpen && !surface.actor.visible, 'closes immediately when requested');
    for (let i = 0; i < 5; i++) {
        surface.open();
        await Scripting.sleep(30);
        surface.close();
        await Scripting.sleep(30);
    }
    surface.open();
    await Scripting.sleep(350);
    assert(surface.actor.visible && surface.isOpen && surface.content.opacity === 255, 'interrupted animation finishes in correct state');
    surface.close(false);
    const clockBox = instance._clockBox;
    const handler = instance._nativeOverlayId;
    instance.disable();
    assert(clockBox.get_parent() === Main.panel.statusArea.dateMenu, 'original clock restored');
    instance.enable();
    assert(instance._surface, 'can re-enable without restarting Shell');
    print('DYNO SMOKE TESTS PASSED');
}
