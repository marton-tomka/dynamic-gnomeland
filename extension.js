import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {IslandSurface} from './island.js';
import {IslandNotifications} from './notifications.js';
import {Waveform} from './waveform.js';
import {IslandWorkspaces} from './workspaces.js';
import {PanelIcons} from './panelIcons.js';

export default class Dyno extends Extension {
    enable() {
        this._signals = [];
        this._captureSources = new Map();
        this._captureTimer = 0;
        this._captureEpoch = 0;
        this._captureActive = false;
        this._audioTimer = 0;
        this._eventTimer = 0;
        this._workspaceTimer = 0;
        this._lastWorkspace = global.workspace_manager.get_active_workspace_index();
        this._wasPlaying = false;
        this._lastPlayer = null;
        this._lastTrack = null;
        this._clockSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        try {
            this._dateMenu = Main.panel.statusArea.dateMenu;
            this._clockBox = this._dateMenu.get_first_child();
            this._oldLabelActor = this._dateMenu.label_actor;
            this._gestureEnabled = this._dateMenu._clickGesture.get_enabled();
            this._menuOpen = this._dateMenu.menu.open;
            this._menuClose = this._dateMenu.menu.close;
            this._dateMenu.menu.close();
            this._surface = new IslandSurface(this._dateMenu);
            this._pill = new St.Button({
                style_class: 'dyno-pill',
                reactive: true, can_focus: true, track_hover: true,
                y_align: Clutter.ActorAlign.CENTER,
                accessible_name: 'Dyno — activity and search',
            });
            const contents = new St.BoxLayout({style_class: 'dyno-pill-content'});
            const centeredContents = new St.Widget({layout_manager: new Clutter.BinLayout()});
            this._waveform = new Waveform();
            this._leftWing = new St.Bin({style_class: 'dyno-pill-wing', child: this._waveform.actor, clip_to_allocation: true,
                y_align: Clutter.ActorAlign.CENTER});
            this._rightContents = new St.BoxLayout({style_class: 'dyno-pill-status'});
            this._rightWing = new St.Bin({style_class: 'dyno-pill-wing', child: this._rightContents, clip_to_allocation: true,
                y_align: Clutter.ActorAlign.CENTER});
            this._pillClock = this._surface.heading;
            this._clockMeasure = new St.Label({style_class: 'dyno-clock', opacity: 0});
            const clockSpace = new St.Bin({style_class: 'dyno-clock-space', child: this._clockMeasure});
            this._pillDot = new St.Widget({style_class: 'dyno-unread-dot', y_align: Clutter.ActorAlign.CENTER});
            this._captureSlot = new St.Bin({visible: false, opacity: 0,
                clip_to_allocation: true, y_align: Clutter.ActorAlign.CENTER});
            this._captureSlot.set_child(new St.Icon({icon_name: 'camera-photo-symbolic', icon_size: 14}));
            contents.add_child(this._leftWing);
            contents.add_child(clockSpace);
            this._rightContents.add_child(this._captureSlot);
            this._rightContents.add_child(this._pillDot);
            contents.add_child(this._rightWing);
            centeredContents.add_child(contents);
            this._pill.set_child(centeredContents);
            this._surface.setAnchor(this._pill, centeredContents, clockSpace);
            this._surface.onEvent = () => this._eventFeedback();
            this._pill.connect('clicked', () => this._toggle());
            this._dateMenu.remove_child(this._clockBox);
            this._clockStorage = new St.Bin({visible: false, child: this._clockBox});
            Main.uiGroup.add_child(this._clockStorage);
            this._dateMenu.add_child(this._pill);
            this._dateMenu.label_actor = this._pillClock;
            this._dateMenu._clickGesture.set_enabled(false);
            // Keep the native clock actor in its exact panel position. Dash to
            // Panel continues to own layout, height, and monitor placement.
            this._dateMenu.menu.open = () => {
                if (this._surface.isOpen && this._surface.page === 'notifications')
                    this._surface.close();
                else
                    this._surface.open('notifications');
            };
            this._dateMenu.menu.close = () => this._surface.close();
            this._connect(this._dateMenu, 'captured-event', (_actor, event) => {
                if (event.type() !== Clutter.EventType.KEY_PRESS)
                    return Clutter.EVENT_PROPAGATE;
                if ([Clutter.KEY_Return, Clutter.KEY_KP_Enter, Clutter.KEY_space, Clutter.KEY_Down]
                    .includes(event.get_key_symbol())) {
                    this._toggle();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
            this._connect(this._dateMenu._clockDisplay, 'notify::text', () => this._syncClock());
            this._connect(this._dateMenu._indicator, 'notify::visible', () => this._syncIndicator());
            this._surface.onMediaChanged = () => this._syncIndicator();
            this._connect(this._surface.actor, 'notify::visible', () =>
                this._waveform.setExposed(!this._surface.actor.visible));
            this._syncClock();
            this._syncIndicator();
            this._connect(Main.messageTray, 'source-added', (_tray, source) => this._watchCaptureSource(source));
            this._connect(Main.messageTray, 'source-removed', (_tray, source) => this._unwatchCaptureSource(source));
            Main.messageTray.getSources().forEach(source => this._watchCaptureSource(source));
            this._notifications = new IslandNotifications(this._surface);
            this._workspaces = new IslandWorkspaces(index => this._workspaceFeedback(index));
            this._panelIcons = new PanelIcons(this.getSettings());

            // Block and restore the existing handler, without rewriting the
            // user's overlay-key setting or any Super+key bindings.
            this._nativeOverlayId = GObject.signal_handler_find(global.display, {signalId: 'overlay-key'});
            if (this._nativeOverlayId)
                global.display.block_signal_handler(this._nativeOverlayId);
            this._connect(global.display, 'overlay-key', () => this._overlayKey());
            this._connect(Main.overview, 'showing', () => {
                if (this._surface.isOpen)
                    this._surface.close(false);
            });
            this._connect(Main.layoutManager, 'system-modal-opened', () => this._surface.close(false));
            this._connect(Main.layoutManager, 'monitors-changed', () => this._surface.close(false));
            this._connect(Main.sessionMode, 'updated', () => {
                if (Main.sessionMode.isLocked || Main.sessionMode.isGreeter)
                    this._surface.close(false);
            });
        } catch (error) {
            this.disable();
            throw error;
        }
    }

    _connect(object, signal, callback) {
        this._signals.push([object, object.connect(signal, callback)]);
    }

    _syncClock() {
        const seconds = this._clockSettings.get_boolean('clock-show-seconds') ? ':%S' : '';
        const time = this._clockSettings.get_string('clock-format') === '12h'
            ? `%-I:%M${seconds} %p` : `%H:%M${seconds}`;
        const text = GLib.DateTime.new_now_local().format(`%-d ${time}`);
        this._clockMeasure.text = text;
        this._surface.setClock(text);
    }

    _syncCompactLayout() {
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        // While media is present, fit a camera plus unread dot without
        // changing width. Completely empty wings take no panel space.
        const left = this._waveform.actor.visible ? 22 * scale : 0;
        const width = Math.ceil(Math.max(left, this._rightContents.get_preferred_width(-1)[1]));
        for (const wing of [this._leftWing, this._rightWing]) {
            if (wing.width !== width)
                wing.width = width;
            wing.visible = width > 0;
        }
    }

    _syncIndicator() {
        const player = this._surface.media.current;
        const playing = player?.status === 'Playing';
        this._waveform.actor.visible = Boolean(player);
        this._waveform.setPlaying(playing);
        this._pillDot.visible = this._dateMenu._indicator.visible;
        this._surface.setUnread(this._pillDot.visible);
        this._syncCompactLayout();
        if (playing && (!this._wasPlaying || this._lastPlayer !== player || this._lastTrack !== player.trackTitle))
            this._audioFeedback();
        else if (!playing) {
            this._stopAudioFeedback();
            if (this._wasPlaying)
                this._eventFeedback();
        }
        this._wasPlaying = playing;
        this._lastPlayer = player;
        this._lastTrack = player?.trackTitle;
    }

    _audioFeedback() {
        if (this._audioTimer)
            GLib.source_remove(this._audioTimer);
        this._pill.add_style_class_name('dyno-audio-active');
        this._surface.setAudioPulse(true);
        this._audioTimer = GLib.timeout_add_once(GLib.PRIORITY_DEFAULT, 2400, () => {
            this._audioTimer = 0;
            this._pill.remove_style_class_name('dyno-audio-active');
            this._surface.setAudioPulse(false);
        });
    }

    _eventFeedback() {
        if (Main.sessionMode.isLocked || Main.sessionMode.isGreeter)
            return;
        if (this._eventTimer)
            GLib.source_remove(this._eventTimer);
        this._pill.add_style_class_name('dyno-event-active');
        this._surface.setEventPulse(true);
        // A burst of events shares one short pulse and one cleanup timeout.
        this._eventTimer = GLib.timeout_add_once(GLib.PRIORITY_DEFAULT, 520, () => {
            this._eventTimer = 0;
            this._pill.remove_style_class_name('dyno-event-active');
            this._surface.setEventPulse(false);
        });
    }

    _stopAudioFeedback() {
        if (this._audioTimer)
            GLib.source_remove(this._audioTimer);
        this._audioTimer = 0;
        this._pill?.remove_style_class_name('dyno-audio-active');
        this._surface?.setAudioPulse(false);
    }

    _workspaceFeedback(index) {
        if (Main.sessionMode.isLocked || Main.sessionMode.isGreeter)
            return;
        if (this._workspaceTimer)
            GLib.source_remove(this._workspaceTimer);
        if (index !== this._lastWorkspace)
            this._eventFeedback();
        this._lastWorkspace = index;
        this._surface.setWorkspaceFeedback(index + 1);
        this._workspaceTimer = GLib.timeout_add_once(GLib.PRIORITY_DEFAULT, 2100, () => {
            this._workspaceTimer = 0;
            this._surface.setWorkspaceFeedback(null);
        });
    }

    _toggle() {
        if (this._surface.isOpen)
            this._surface.close();
        else
            this._surface.open();
    }

    _watchCaptureSource(source) {
        if (this._captureSources.has(source) || !(source.icon instanceof Gio.ThemedIcon) ||
            !source.icon.get_names().includes('screenshooter-symbolic'))
            return;
        const original = source.addNotification;
        const owner = this;
        const replacement = function (notification) {
            // GNOME's successful screenshot notification carries its captured
            // image. Recording errors share this source but have no image.
            // This avoids matching translated text or watching directories.
            if (notification.gicon instanceof St.ImageContent) {
                owner._captureFeedback();
                // The capture pipeline has already played the shutter sound.
                // Suppress this success notification before it enters any queue
                // or notification list; recording errors still use GNOME.
                notification.destroy();
                return;
            }
            original.call(this, notification);
        };
        source.addNotification = replacement;
        this._captureSources.set(source, {original, replacement});
    }

    _unwatchCaptureSource(source) {
        const saved = this._captureSources.get(source);
        if (saved && source.addNotification === saved.replacement)
            source.addNotification = saved.original;
        this._captureSources.delete(source);
    }

    _captureFeedback() {
        if (Main.sessionMode.isLocked || Main.sessionMode.isGreeter)
            return;
        const epoch = ++this._captureEpoch;
        if (this._captureTimer)
            GLib.source_remove(this._captureTimer);
        this._captureActive = true;
        this._captureSlot.show();
        this._syncCompactLayout();
        this._pill.add_style_class_name('dyno-capture-active');
        this._captureSlot.ease({opacity: 255, duration: 180,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        this._surface.setCaptureFeedback(true);
        this._captureTimer = GLib.timeout_add_once(GLib.PRIORITY_DEFAULT, 1300, () => {
            this._captureTimer = 0;
            this._captureActive = false;
            this._pill.remove_style_class_name('dyno-capture-active');
            this._surface.setCaptureFeedback(false);
            this._captureSlot.ease({opacity: 0, duration: 180,
                mode: Clutter.AnimationMode.EASE_IN_OUT_CUBIC,
                onComplete: () => {
                    if (epoch === this._captureEpoch) {
                        this._captureSlot.hide();
                        this._syncCompactLayout();
                    }
                }});
        });
    }

    _overlayKey() {
        if (Main.sessionMode.isLocked || Main.sessionMode.isGreeter)
            return;
        if (this._surface.isOpen) {
            this._surface.close(false);
            Main.overview.show();
        } else if (Main.overview.visible) {
            const apps = Main.overview.dash.showAppsButton;
            if (apps.checked)
                Main.overview.hide();
            else
                apps.checked = true;
        } else {
            this._surface.open();
        }
    }

    disable() {
        this._panelIcons?.destroy();
        this._panelIcons = null;
        this._workspaces?.destroy();
        this._workspaces = null;
        if (this._workspaceTimer)
            GLib.source_remove(this._workspaceTimer);
        this._workspaceTimer = 0;
        if (this._eventTimer)
            GLib.source_remove(this._eventTimer);
        this._eventTimer = 0;
        if (this._surface)
            this._surface.onEvent = null;
        this._stopAudioFeedback();
        this._captureEpoch++;
        if (this._captureTimer)
            GLib.source_remove(this._captureTimer);
        this._captureTimer = 0;
        for (const source of this._captureSources?.keys() ?? [])
            this._unwatchCaptureSource(source);
        for (const [object, id] of this._signals ?? [])
            object.disconnect(id);
        this._signals = [];
        this._notifications?.destroy();
        this._notifications = null;
        if (this._nativeOverlayId) {
            global.display.unblock_signal_handler(this._nativeOverlayId);
            this._nativeOverlayId = 0;
        }
        this._surface?.destroy();
        this._surface = null;
        if (this._dateMenu && this._menuOpen) {
            this._dateMenu.menu.open = this._menuOpen;
            this._dateMenu.menu.close = this._menuClose;
            this._dateMenu._clickGesture.set_enabled(this._gestureEnabled);
            this._dateMenu.label_actor = this._oldLabelActor;
        }
        this._waveform?.destroy();
        this._waveform = null;
        this._pill?.destroy();
        this._pill = null;
        this._clockStorage?.set_child(null);
        this._clockStorage?.destroy();
        this._clockStorage = null;
        if (this._clockBox && !this._clockBox.get_parent())
            this._dateMenu.add_child(this._clockBox);
        this._clockBox = null;
        this._dateMenu = null;
        this._clockSettings = null;
    }
}
