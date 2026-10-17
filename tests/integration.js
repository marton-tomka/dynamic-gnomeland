import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import * as Screenshot from 'resource:///org/gnome/shell/ui/screenshot.js';
import {WorkspaceAnimationController} from 'resource:///org/gnome/shell/ui/workspaceAnimation.js';
import {WorkspaceSwitcherPopup} from 'resource:///org/gnome/shell/ui/workspaceSwitcherPopup.js';
import {ControlsState} from 'resource:///org/gnome/shell/ui/overviewControls.js';
import {createMockMedia} from './mock-media.js';

const out = GLib.getenv('DYNO_TEST_OUTPUT') ?? '/tmp/dyno-tests';
GLib.mkdir_with_parents(out, 0o755);
let passed = 0;
function assert(condition, message) {
    if (!condition)
        throw new Error(message);
    passed++;
    print(`PASS: ${message}`);
}
function center(actor) {
    const [x] = actor.get_transformed_position();
    const [width] = actor.get_transformed_size();
    return x + width / 2;
}
async function capture(name) {
    const stream = Gio.File.new_for_path(`${out}/${name}.png`).replace(null, false, Gio.FileCreateFlags.NONE, null);
    await new Shell.Screenshot().screenshot(false, stream);
    stream.close(null);
}
let keyboard;
let pointer;
async function press(key) {
    keyboard.notify_keyval(GLib.get_monotonic_time(), key, Clutter.KeyState.PRESSED);
    await Scripting.sleep(15);
    keyboard.notify_keyval(GLib.get_monotonic_time(), key, Clutter.KeyState.RELEASED);
    await Scripting.sleep(60);
}

async function click(actor) {
    const [x, y] = actor.get_transformed_position();
    const [w, h] = actor.get_transformed_size();
    // Leave the top-left hot-corner barrier before moving horizontally.
    global.stage.context.get_backend().get_default_seat().warp_pointer(0, y + h / 2);
    await Scripting.sleep(30);
    global.stage.context.get_backend().get_default_seat().warp_pointer(x + w / 2, y + h / 2);
    await Scripting.sleep(40);
    pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
    await Scripting.sleep(30);
    pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
    await Scripting.sleep(80);
}

export async function run() {
    Main.overview.hide();
    await Scripting.sleep(400);
    if (GLib.getenv('DYNO_TEST_REDUCED') === '1') {
        global.force_animations = false;
        const settings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        settings.set_boolean('enable-animations', false);
        await Scripting.sleep(100);
        assert(!St.Settings.get().enable_animations, 'reduced motion is active');
    }
    const extension = Main.extensionManager.lookup('dyno@local');
    assert(extension?.stateObj?._surface, 'extension enabled');
    const instance = extension.stateObj;
    if (GLib.getenv('DYNO_TEST_DTP') === '1') {
        instance.disable();
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
        assert(dtp.state === 1, `Dash to Panel enabled (${dtp.error})`);
        instance.enable();
        assert(instance._pill.get_parent() === Main.panel.statusArea.dateMenu, 'island uses Dash to Panel native clock position');
    }
    const surface = instance._surface;
    const controls = Main.overview._overview.controls.searchController._searchResults;
    const originalProviders = controls._providers;
    controls._providers = originalProviders.filter(p => p.id === 'applications');
    keyboard = global.stage.context.get_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    pointer = global.stage.context.get_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    await Scripting.sleep(100);
    await capture('relaxed');
    const mock = createMockMedia();
    await Scripting.sleep(450);
    assert(surface.media.current?.trackTitle === 'Late night / live session', 'MPRIS media discovered through shared GNOME source');
    await Scripting.sleep(80);
    assert(Math.abs(center(instance._pillClock) - center(instance._pill)) < 1, 'compact clock centred with media indicator');
    assert(instance._waveform._running === St.Settings.get().enable_animations, 'waveform animates only when motion is enabled');
    assert(instance._pill.has_style_class_name('dyno-audio-active'), 'playback starts a subtle border pulse');
    mock.setPlayback('Paused');
    await Scripting.sleep(60);
    assert(!instance._waveform._running && instance._pill.has_style_class_name('dyno-event-active'),
        'pausing starts the short event glow and stops the repeating waveform');
    if (St.Settings.get().enable_animations) {
        assert(instance._waveform._bars.every(bar => bar.get_transition('dyno-wave')?.repeat_count === 0),
            'visible pause uses a finite settling animation');
    } else {
        assert(instance._waveform._bars.every(bar => !bar.get_transition('dyno-wave')),
            'reduced motion settles paused bars without animation');
    }
    await Scripting.sleep(230);
    assert(instance._waveform._bars.every(bar => Math.abs(bar.get_transformed_size()[1] - 2) < 0.1 &&
        !bar.get_transition('dyno-wave')), 'paused waveform settles into equal two-pixel dots with no animation left');
    await capture('paused-dots');
    await Scripting.sleep(500);
    assert(!instance._eventTimer && !instance._pill.has_style_class_name('dyno-event-active'),
        'short event glow clears automatically');
    mock.setPlayback('Playing');
    await Scripting.sleep(60);
    mock.setPlayback('Paused');
    await Scripting.sleep(35);
    mock.setPlayback('Playing');
    await Scripting.sleep(70);
    assert(instance._waveform._running === St.Settings.get().enable_animations,
        'rapid pause and resume returns to the correct playback animation');
    mock.setArtwork(Gio.File.new_for_uri(import.meta.url).get_parent().resolve_relative_path('fixtures/wide.svg').get_uri());
    await capture('idle');
    const clockActor = instance._pillClock;
    const openingClockFrames = [];
    const clockPaintId = global.stage.connect('after-paint', () => {
        openingClockFrames.push({opacity: clockActor.get_paint_opacity(), mapped: clockActor.mapped});
    });
    await press(Clutter.KEY_Super_L);
    await Scripting.sleep(300);
    global.stage.disconnect(clockPaintId);
    assert(openingClockFrames.length > 0 && openingClockFrames.every(frame => frame.opacity === 255 && frame.mapped),
        'clock stays fully visible on every painted opening frame');
    assert(surface.heading === clockActor && surface.actor.contains(clockActor), 'one clock actor moves from pill to expanded island');
    assert(surface.isOpen && !Main.overview.visible, 'single Super opens island, without overview');
    assert(surface.background.has_style_class_name('dyno-event-active'), 'opening the island gets the short event glow');
    assert(surface.mediaCard.visible && surface.entry.visible, 'media and search appear together');
    assert(global.stage.get_key_focus() === surface.entry.clutter_text, 'search focused after Super');
    assert(Math.abs(center(surface.heading) - center(instance._pill)) < 1, 'expanded clock stays at the compact clock centre');
    const [, clockY] = surface.heading.get_transformed_position();
    const [, buttonY] = surface.clockButton.get_transformed_position();
    assert(Math.abs(clockY + surface.heading.height / 2 - buttonY - surface.clockButton.height / 2) < 1,
        'persistent clock aligns with its expanded header button');
    assert(!instance._waveform._running, 'hidden compact waveform stops during expanded view');
    await Scripting.sleep(250);
    assert(Math.abs(surface.artBin.width / surface.artBin.height - 16 / 9) < 0.01, 'artwork frame is 16:9');
    assert(Math.abs(surface.art.width / surface.art.height - 16 / 9) < 0.01, 'wide artwork preserves its aspect ratio');
    assert(Math.abs(surface.art.height - surface.artBin.height) < 1, 'wide artwork fits the top and bottom');
    mock.changeVolume(0.6);
    await Scripting.sleep(60);
    assert(!surface.background.get_transition('width') && !surface.background.get_transition('height'), 'irrelevant media updates do not restart animations');
    await capture('home');
    await press(Clutter.KEY_Up);
    assert(global.stage.get_key_focus() === surface.play, 'Up reaches playback from search');
    await capture('focus-play');
    mock.setArtwork(Gio.File.new_for_uri(import.meta.url).get_parent().resolve_relative_path('fixtures/square.svg').get_uri());
    await Scripting.sleep(300);
    assert(Math.abs(surface.art.width - surface.art.height) < 1, 'square artwork is not stretched');
    assert(Math.abs(surface.art.height - surface.artBin.height) < 1, 'square artwork fits frame height');
    await capture('square-art');
    await press(Clutter.KEY_Return);
    assert(mock.calls.playPause === 1 && surface.media.current.status === 'Paused', 'Enter invokes playback once');
    assert(instance._waveform._bars.every(bar => Math.abs(bar.scale_y - 2 / 13) < 0.001 && !bar.get_transition('dyno-wave')),
        'pausing while the island is open updates the hidden waveform to dots');
    await click(surface.play);
    await Scripting.sleep(70);
    assert(mock.calls.playPause === 2 && surface.media.current.status === 'Playing', 'mouse action uses identical playback behaviour');
    await press(Clutter.KEY_Right);
    assert(global.stage.get_key_focus() === surface.next, 'Right moves to next-track control');
    await press(Clutter.KEY_Return);
    assert(mock.calls.next === 1, 'Enter invokes next-track control');
    await press(Clutter.KEY_Down);
    assert(global.stage.get_key_focus() === surface.entry.clutter_text, 'Down returns to search');
    surface.entry.set_text('settings');
    await Scripting.sleep(250);
    assert(surface.search.results.length > 0, 'search produces application results');
    await press(Clutter.KEY_Down);
    assert(global.stage.get_key_focus() === surface.resultsBox.get_first_child(), 'Down reaches first search result');
    await press(Clutter.KEY_Up);
    assert(global.stage.get_key_focus() === surface.entry.clutter_text, 'Up returns from result to search');
    await capture('search');
    await press(Clutter.KEY_Super_L);
    await Scripting.sleep(300);
    assert(!surface.isOpen && Main.overview.visible, 'second Super opens native overview');
    await press(Clutter.KEY_Super_L);
    await Scripting.sleep(300);
    const overviewControls = Main.overview._overview.controls;
    assert(Main.overview.visible && overviewControls._stateAdjustment.value === ControlsState.APP_GRID &&
        overviewControls.appDisplay.mapped && overviewControls.appDisplay.get_paint_opacity() > 0,
        'third Super displays the full app grid');
    await capture('super-app-grid');
    await press(Clutter.KEY_Super_L);
    await Scripting.sleep(300);
    assert(!Main.overview.visible && !surface.isOpen, 'fourth Super returns to desktop');
    await press(Clutter.KEY_Super_L);
    await press(Clutter.KEY_Super_L);
    await press(Clutter.KEY_Super_L);
    await Scripting.sleep(350);
    assert(Main.overview.visible && overviewControls._stateAdjustment.value === ControlsState.APP_GRID,
        'rapid triple Super reaches the app grid during opening animations');
    await press(Clutter.KEY_Super_L);
    await Scripting.sleep(300);
    assert(!Main.overview.visible, 'rapid Super cycle closes cleanly');
    await click(instance._pill);
    await Scripting.sleep(280);
    assert(surface.isOpen && surface.page === 'home', 'click opens the same default view');

    surface.calendar.emit('clicked', 1);
    await Scripting.sleep(250);
    assert(surface.page === 'calendar', 'calendar button opens calendar inside island');
    await capture('calendar');
    await press(Clutter.KEY_Escape);
    assert(surface.page === 'home' && surface.isOpen, 'Escape returns from calendar to home');
    const source = new MessageTray.Source({title: 'Dyno test', iconName: 'dialog-information-symbolic'});
    Main.messageTray.add(source);
    const notification = new MessageTray.Notification({source, title: 'Your workspace is ready', body: 'A real GNOME notification in the shared notification centre.'});
    source.addNotification(notification);
    surface.notifications.emit('clicked', 1);
    await Scripting.sleep(250);
    assert(surface.page === 'notifications' && surface.nativeHost.contains(Main.panel.statusArea.dateMenu._messageList), 'notification button opens native notification centre');
    await capture('notifications');
    await press(Clutter.KEY_Escape);
    const closingClockFrames = [];
    const closePaintId = global.stage.connect('after-paint', () =>
        closingClockFrames.push({opacity: clockActor.get_paint_opacity(), mapped: clockActor.mapped}));
    await press(Clutter.KEY_Escape);
    await Scripting.sleep(250);
    global.stage.disconnect(closePaintId);
    assert(closingClockFrames.length > 0 && closingClockFrames.every(frame => frame.opacity === 255 && frame.mapped),
        'clock stays fully visible on every painted closing frame');
    assert(instance._pill.contains(clockActor), 'same clock returns to the compact island');
    assert(!surface.isOpen && !surface.actor.visible, 'Escape closes and finishes collapse');
    assert(instance._pill.opacity === 255, 'compact island visible after collapse');
    assert(!Main.messageTray._bannerBlocked, 'notification delivery restored after closing');
    source.destroy();

    await Scripting.sleep(250);
    const previewSource = new MessageTray.Source({title: 'Incoming message', iconName: 'dialog-information-symbolic'});
    Main.messageTray.add(previewSource);
    const previewNotification = new MessageTray.Notification({source: previewSource, title: 'Your notification, in the island', body: 'The native queue and actions remain in GNOME; this card expands from the clock.', forFeedback: true});
    let actionCalls = 0;
    previewNotification.addAction('Done', () => actionCalls++);
    const priorFocus = global.stage.get_key_focus();
    previewSource.addNotification(previewNotification);
    await Scripting.sleep(400);
    assert(surface.isPreview && !surface.isOpen, 'incoming notification expands the island');
    assert(surface.bannerHost.contains(Main.messageTray._banner), 'native banner appears only inside island');
    assert(Main.messageTray._banner.get_paint_opacity() === 255, 'notification contents are visibly rendered');
    assert(global.stage.get_key_focus() === priorFocus && surface._grab === null, 'passive notification does not steal focus');
    assert(Math.abs(center(surface.heading) - center(instance._pillClock)) < 1, 'notification expansion preserves centred clock');
    assert(Main.messageTray._notificationState === MessageTray.State.SHOWN, 'native notification show transition completes');
    assert(surface.background.has_style_class_name('dyno-event-active'), 'incoming notification gets the short pink glow');
    const pulseTimer = instance._eventTimer;
    instance._notifications._sync();
    assert(instance._eventTimer === pulseTimer, 'redrawing the same notification does not prolong its glow');
    await capture('notification-preview');
    await Scripting.sleep(650);
    assert(!instance._eventTimer && !surface.background.has_style_class_name('dyno-event-active') && surface.isPreview,
        'notification glow ends before the notification itself expires');
    previewNotification.actions[0].activate();
    await Scripting.sleep(300);
    assert(actionCalls === 1 && !surface.isPreview, 'native notification action works and closes preview');
    await press(Clutter.KEY_Shift_L);
    surface.open();
    const queuedSource = new MessageTray.Source({title: 'Queued notification', iconName: 'dialog-information-symbolic'});
    Main.messageTray.add(queuedSource);
    queuedSource.addNotification(new MessageTray.Notification({source: queuedSource,
        title: 'Delivered after search closes', body: 'This message should not interrupt keyboard input.', forFeedback: true}));
    await Scripting.sleep(100);
    assert(!surface.isPreview && global.stage.get_key_focus() === surface.entry.clutter_text, 'notification waits while search is in use');
    surface.close();
    await Scripting.sleep(550);
    assert(surface.isPreview && surface._grab === null, 'queued notification expands after the interactive island closes');
    const seat = global.stage.context.get_backend().get_default_seat();
    seat.warp_pointer(0, 600);
    await Scripting.sleep(30);
    seat.warp_pointer(100, 600);
    await press(Clutter.KEY_Shift_L);
    await Scripting.sleep(4400);
    assert(!surface.isPreview && !surface.actor.visible && Main.messageTray._notificationState === MessageTray.State.HIDDEN,
        'notification expires and restores the compact island');
    assert(queuedSource.notifications.length === 1, 'expired non-transient notification remains in history');
    queuedSource.destroy();
    const dnd = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
    dnd.set_boolean('show-banners', false);
    const quietSource = new MessageTray.Source({title: 'Quiet notification', iconName: 'dialog-information-symbolic'});
    Main.messageTray.add(quietSource);
    quietSource.addNotification(new MessageTray.Notification({source: quietSource, title: 'Stored quietly', body: 'Do Not Disturb test'}));
    await Scripting.sleep(180);
    assert(!surface.isPreview && quietSource.notifications.length === 1, 'Do Not Disturb keeps notification in history without preview');
    assert(!instance._eventTimer, 'Do Not Disturb does not trigger a notification glow');
    quietSource.destroy();
    dnd.set_boolean('show-banners', true);
    await Scripting.waitTestWindows();

    assert(await Promise.race([
        Scripting.waitLeisure().then(() => true),
        Scripting.sleep(600).then(() => false),
    ]), 'playing waveform does not keep Shell busy');

    const mutterSettings = new Gio.Settings({schema_id: 'org.gnome.mutter'});
    const wmSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.wm.preferences'});
    mutterSettings.set_boolean('dynamic-workspaces', false);
    wmSettings.set_int('num-workspaces', 3);
    await Scripting.sleep(250);
    const manager = global.workspace_manager;
    manager.get_workspace_by_index(0).activate(global.get_current_time());
    await Scripting.sleep(100);
    const compactWidth = instance._pill.width;
    const workspaceWidths = [];
    const widthPaintId = global.stage.connect('after-paint', () => workspaceWidths.push(instance._pill.width));
    keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Super_L, Clutter.KeyState.PRESSED);
    keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Page_Down, Clutter.KeyState.PRESSED);
    await Scripting.sleep(40);
    if (St.Settings.get().enable_animations)
        assert(Main.wm._workspaceAnimation._switchData !== null, 'native desktop slide animation still runs');
    keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Page_Down, Clutter.KeyState.RELEASED);
    keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Super_L, Clutter.KeyState.RELEASED);
    await Scripting.sleep(350);
    global.stage.disconnect(widthPaintId);
    assert(manager.get_active_workspace_index() === 1, 'workspace keyboard shortcut still switches workspaces');
    assert(Main.wm._workspaceAnimation._switchData === null && !Main.wm._switchInProgress,
        'native workspace slide completes normally');
    assert(Main.wm._workspaceAnimation.animateSwitch === WorkspaceAnimationController.prototype.animateSwitch,
        'native workspace animation method remains unchanged');
    assert(Main.wm._workspaceSwitcherPopup?.opacity === 0, 'bottom workspace indicator is suppressed');
    assert(clockActor.text === 'Workspace 2', 'workspace number temporarily replaces compact clock');
    assert(instance._pill.has_style_class_name('dyno-event-active'), 'workspace change gets the short pink glow');
    assert(workspaceWidths.length > 0 && workspaceWidths.every(width => width === compactWidth),
        'workspace feedback never resizes the island');
    await capture('workspace-feedback');
    assert(Math.abs(center(instance._pillClock) - center(instance._pill)) < 1, 'workspace feedback stays centred');
    const tracker = Main.wm._workspaceAnimation._swipeTracker;
    tracker.emit('begin', Main.layoutManager.primaryIndex);
    assert(Main.wm._workspaceAnimation._switchData !== null, 'native touchpad gesture animation remains intact');
    tracker.emit('update', 1.7);
    tracker.emit('end', 150, 2);
    tracker._reset();
    await Scripting.sleep(220);
    assert(manager.get_active_workspace_index() === 2, 'touchpad gesture protocol commits the selected workspace');
    assert(Main.wm._workspaceAnimation._switchData === null, 'native gesture animation completes cleanly');
    tracker.emit('begin', Main.layoutManager.primaryIndex);
    tracker.emit('update', 1.4);
    tracker.emit('end', 0, 2);
    tracker._reset();
    await Scripting.sleep(100);
    assert(manager.get_active_workspace_index() === 2, 'cancelled workspace gesture keeps the active workspace');
    await Scripting.sleep(2250);
    assert(clockActor.text === surface._clock && instance._workspaceTimer === 0, 'workspace feedback restores time without a running timer');

    // Use GNOME's real capture pipeline; only this disposable session has
    // saving to disk disabled, so it cannot write into the user's Pictures.
    const lockdown = new Gio.Settings({schema_id: 'org.gnome.desktop.lockdown'});
    lockdown.set_boolean('disable-save-to-disk', true);
    const [content, scale] = await new Shell.Screenshot().screenshot_stage_to_content();
    await Screenshot.captureScreenshot(content.get_texture(), null, scale, null);
    await Scripting.sleep(230);
    assert(instance._captureSlot.visible && instance._captureSlot.width >= 14, 'real screenshot produces camera confirmation');
    assert(instance._captureSlot.child instanceof St.Icon, 'screenshot confirmation is icon-only');
    assert(instance._pill.has_style_class_name('dyno-capture-active') && surface.background.has_style_class_name('dyno-capture-active'),
        'screenshot success has its own coloured glow');
    assert(instance._pill.width === compactWidth, 'screenshot feedback does not resize the island');
    assert(!surface.isOpen, 'screenshot confirmation does not open or grab focus');
    assert(!surface.isPreview && Main.messageTray.getSources().filter(s => s.icon instanceof Gio.ThemedIcon && s.icon.get_names().includes('screenshooter-symbolic')).every(s => s.notifications.length === 0), 'screenshot success has neither banner nor notification history entry');
    assert(Math.abs(center(instance._pillClock) - center(instance._pill)) < 1, 'camera confirmation preserves clock position');
    await capture('screenshot-confirmation');
    await Scripting.sleep(1400);
    assert(!instance._captureSlot.visible && instance._captureTimer === 0, 'screenshot feedback finishes with no timer left running');
    surface.open();
    const focusBeforeCapture = global.stage.get_key_focus();
    await Screenshot.captureScreenshot(content.get_texture(), null, scale, null);
    await Scripting.sleep(100);
    assert(surface.headerCapture.visible && global.stage.get_key_focus() === focusBeforeCapture, 'capture feedback preserves search and keyboard focus');
    await capture('capture-expanded');
    assert(Math.abs(center(surface.heading) - center(instance._pillClock)) < 1, 'header capture indicator does not move the clock');
    await Scripting.sleep(1500);
    surface.close(false);

    for (let i = 0; i < 8; i++) {
        surface.open();
        await Scripting.sleep(25);
        surface.close();
        await Scripting.sleep(25);
    }
    surface.open();
    await Scripting.sleep(300);
    assert(surface.isOpen && surface.content.opacity === 255 && surface.background.height === surface.actor.height,
        'rapidly interrupted animations settle correctly');
    surface.close(false);
    assert(surface.search._timer === 0 && surface._grab === null, 'closed island has no search timer or input grab');
    controls._providers = [{
        id: 'dyno-race-test', isRemoteProvider: true,
        async getInitialResultSet(terms) {
            await Scripting.sleep(terms[0] === 'obsolete' ? 180 : 20);
            return [terms[0]];
        },
        async getResultMetas(ids) {
            return ids.map(id => ({id, name: id, createIcon: () => new St.Icon({icon_name: 'system-search-symbolic', icon_size: 24})}));
        },
    }];
    surface.open();
    surface.entry.set_text('obsolete');
    surface.search.flush();
    await Scripting.sleep(15);
    surface.entry.set_text('fresh');
    surface.search.flush();
    await Scripting.sleep(240);
    assert(surface.search.results.some(r => r.meta.name === 'fresh') && !surface.search.results.some(r => r.meta.name === 'obsolete'), 'cancelled query cannot overwrite newer results');
    surface.close(false);
    await Scripting.sleep(100);
    mock.destroy();
    await Scripting.sleep(100);
    assert(!surface.media.current, 'closed MPRIS source removed');
    const nativeCalendarParent = Main.panel.statusArea.dateMenu._calendar.get_parent();
    const clockBox = instance._clockBox;
    await press(Clutter.KEY_Shift_L);
    const restoreSource = new MessageTray.Source({title: 'Restoration test', iconName: 'dialog-information-symbolic'});
    Main.messageTray.add(restoreSource);
    restoreSource.addNotification(new MessageTray.Notification({source: restoreSource, title: 'Restore this native banner', forFeedback: true}));
    await Scripting.sleep(350);
    assert(surface.isPreview, 'preview active before disable');
    const nativeBanner = Main.messageTray._banner;
    const originalUpdate = instance._notifications._originalUpdate;
    const originalHide = instance._notifications._originalHide;
    const originalWorkspaceDisplay = instance._workspaces._originalDisplay;
    instance.disable();
    assert(instance._eventTimer === 0, 'disable removes an active event glow timeout');
    assert(WorkspaceSwitcherPopup.prototype.display === originalWorkspaceDisplay, 'native bottom workspace indicator restored on disable');
    const nativePopup = new WorkspaceSwitcherPopup();
    nativePopup.display(manager.get_active_workspace_index());
    await Scripting.sleep(150);
    assert(nativePopup.visible && nativePopup.opacity === 255, 'bottom indicator is visible again after disable');
    nativePopup.destroy();
    assert(nativeBanner.get_parent() === Main.messageTray._bannerBin, 'disabling restores an active banner to GNOME');
    assert(Main.messageTray._updateShowingNotification === originalUpdate && Main.messageTray._hideNotification === originalHide,
        'native notification methods restored on disable');
    assert(Main.messageTray._notificationFocusGrabber._actor === Main.messageTray._bannerBin, 'native notification focus target restored');
    restoreSource.destroy();
    tracker.emit('begin', Main.layoutManager.primaryIndex);
    assert(Main.wm._workspaceAnimation._switchData !== null, 'native swipe handler restored on disable');
    tracker.emit('end', 0, manager.get_active_workspace_index());
    tracker._reset();
    await Scripting.sleep(100);
    assert(Main.wm._workspaceAnimation._switchData === null, 'restored native gesture completes cleanly');
    assert(clockBox.get_parent() === Main.panel.statusArea.dateMenu, 'native clock restored on disable');
    assert(Main.panel.statusArea.dateMenu._calendar.get_parent() === nativeCalendarParent, 'native calendar ownership preserved');
    instance.enable();
    assert(instance._surface, 'clean re-enable succeeds');
    instance.disable();
    controls._providers = originalProviders;
    const summary = JSON.stringify({passed, shell: '50.1', session: 'isolated headless Wayland', animations: St.Settings.get().enable_animations}, null, 2);
    GLib.file_set_contents(`${out}/results.json`, summary);
    print(`DYNO INTEGRATION: ${passed} PASSED`);
}
