import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {State} from 'resource:///org/gnome/shell/ui/messageTray.js';

// Keep GNOME's queue, urgency, DND, sound, action handling, and timeouts.
// Only the native banner's parent and presentation change.
export class IslandNotifications {
    constructor(surface) {
        this.surface = surface;
        this.tray = Main.messageTray;
        this._syncId = 0;
        this._originalUpdate = this.tray._updateShowingNotification;
        this._originalHide = this.tray._hideNotification;
        const owner = this;
        this._update = function (...args) {
            const result = owner._originalUpdate.apply(this, args);
            owner._sync();
            return result;
        };
        this._hide = function (animate) {
            owner.surface.hidePreview(animate);
            return owner._originalHide.call(this, animate);
        };
        this.tray._updateShowingNotification = this._update;
        this.tray._hideNotification = this._hide;
        this._visibleId = this.tray.connect('notify::visible', () => {
            if (!this.tray.visible) {
                this.surface.hidePreview(false);
                return;
            }
            // Run after the native state transition that emitted notify.
            if (!this._syncId) {
                this._syncId = GLib.idle_add_once(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._syncId = 0;
                    this._sync();
                });
            }
        });
        this._sync();
    }

    _sync() {
        if (this.tray.visible && this.tray._banner && !this.tray._bannerBlocked &&
            [State.SHOWING, State.SHOWN].includes(this.tray._notificationState)) {
            this.tray._banner.expand(false);
            this.surface.showPreview(this.tray._banner);
            this.tray._notificationFocusGrabber._actor = this.surface.bannerHost;
        }
    }

    destroy() {
        if (this._syncId)
            GLib.source_remove(this._syncId);
        this._syncId = 0;
        this.tray.disconnect(this._visibleId);
        if (this.tray._updateShowingNotification === this._update)
            this.tray._updateShowingNotification = this._originalUpdate;
        if (this.tray._hideNotification === this._hide)
            this.tray._hideNotification = this._originalHide;
        this.surface.hidePreview(false);
        this.surface = null;
    }
}
