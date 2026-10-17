import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const EFFECT = 'dyno-dark-tray';
const FOREGROUND = 'color: #111111; text-shadow: none;';
const ICON_FOREGROUND = 'color: #111111; icon-shadow: none; success-color: #111111; warning-color: #111111; error-color: #111111;';

const DarkTrayEffect = GObject.registerClass(
class DynoDarkTrayEffect extends Clutter.ShaderEffect {
    vfunc_get_static_shader_source() {
        // Input is premultiplied. Subtracting luminance from alpha preserves
        // transparent holes, antialiased edges, and internal grey detail.
        // The native shader program is shared by instances of this class.
        return `uniform sampler2D tex;
            void main() {
                vec4 pixel = texture2D(tex, cogl_tex_coord_in[0].st);
                float shade = max(0.0, pixel.a - dot(pixel.rgb, vec3(0.2126, 0.7152, 0.0722)));
                cogl_color_out = vec4(vec3(shade), pixel.a) * cogl_color_in;
            }`;
    }
});

export class PanelIcons {
    constructor(settings) {
        this._settings = settings;
        this._actors = new Map();
        this._signals = [];
        this._syncId = 0;
        this._settingsId = settings.connect('changed::dark-panel-icons', () => this._update());
        this._update();
    }

    _update() {
        const enabled = this._settings.get_boolean('dark-panel-icons');
        if (enabled === this._enabled)
            return;
        this._clear();
        this._enabled = enabled;
        if (!enabled)
            return;
        this._signals.push([Main.extensionManager, Main.extensionManager.connect('extension-state-changed', () => this._queueSync())]);
        this._signals.push([Main.layoutManager, Main.layoutManager.connect('monitors-changed', () => this._queueSync())]);
        this._sync();
    }

    _queueSync() {
        if (!this._enabled || this._syncId)
            return;
        this._syncId = GLib.idle_add_once(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._syncId = 0;
            this._sync();
        });
    }

    _sync() {
        if (!this._enabled)
            return;
        const dtp = global.dashToPanel;
        if (dtp !== this._dtp) {
            if (this._dtp)
                this._dtp.disconnect(this._dtpId);
            this._dtp = dtp;
            this._dtpId = dtp?.connect('panels-created', () => this._queueSync());
        }
        const panels = new Set([Main.panel, ...(dtp?.panels ?? []).map(p => p.panel)]);
        const wanted = new Set();
        const visit = (actor, clock) => {
            if (!actor || wanted.has(actor) || actor === clock || actor === clock?.container)
                return;
            wanted.add(actor);
            // St.Icon and St.Label own their drawing actors. Handling their
            // internal children again would invert or recolour them twice.
            if (actor instanceof St.Icon || actor instanceof St.Label)
                return;
            for (const child of actor.get_children())
                visit(child, clock);
        };
        for (const panel of panels) {
            if (!panel)
                continue;
            const clock = panel.statusArea?.dateMenu;
            visit(panel._rightBox, clock);
            // Dash to Panel can place Quick Settings outside the right box.
            const quick = panel.statusArea?.quickSettings;
            visit(quick?.container ?? quick, clock);
        }
        for (const [actor, record] of this._actors) {
            if (!wanted.has(actor))
                this._forget(actor, record);
        }
        for (const actor of wanted) {
            if (!this._actors.has(actor))
                this._watch(actor);
        }
    }

    _watch(actor) {
        const record = {ids: [], style: null, appliedStyle: undefined, updating: false, effect: null};
        this._actors.set(actor, record);
        record.ids.push(actor.connect('destroy', () => {
            record.ids.forEach(id => actor.disconnect(id));
            this._actors.delete(actor);
        }));
        if (actor instanceof St.Icon || actor instanceof St.Label) {
            record.ids.push(actor.connect('notify::style', () => this._paint(actor, record)));
            if (actor instanceof St.Icon)
                record.ids.push(actor.connect('notify::is-symbolic', () => this._paint(actor, record)));
        } else {
            record.ids.push(actor.connect('child-added', () => this._queueSync()));
            record.ids.push(actor.connect('child-removed', () => this._queueSync()));
        }
        this._paint(actor, record);
    }

    _paint(actor, record) {
        if (record.updating || !this._enabled)
            return;
        record.updating = true;
        try {
            if (actor instanceof St.Icon || actor instanceof St.Label) {
                const current = actor.get_style();
                if (current !== record.appliedStyle)
                    record.style = current;
                const foreground = actor instanceof St.Icon ? ICON_FOREGROUND : FOREGROUND;
                // St does not reliably resolve duplicate inline declarations
                // like a web browser. Keep one foreground declaration, while
                // retaining the untouched original for restoration.
                const remaining = (record.style ?? '')
                    .replace(/(^|;)\s*(?:color|text-shadow|icon-shadow|success-color|warning-color|error-color)\s*:[^;]*/gi, '$1')
                    .replace(/;\s*(?:;\s*)+/g, '; ')
                    .replace(/^[;\s]+|[;\s]+$/g, '');
                record.appliedStyle = remaining ? `${remaining}; ${foreground}` : foreground;
                if (current !== record.appliedStyle)
                    actor.set_style(record.appliedStyle);
            }
            const bitmap = actor instanceof St.Icon ? !actor.get_is_symbolic()
                : actor.get_parent()?.has_style_class_name?.('appindicator-trayicons-box');
            if (bitmap && !record.effect) {
                record.effect = new DarkTrayEffect();
                actor.add_effect_with_name(EFFECT, record.effect);
            } else if (!bitmap && record.effect) {
                actor.remove_effect(record.effect);
                record.effect = null;
            }
        } finally {
            record.updating = false;
        }
    }

    _forget(actor, record) {
        record.ids.forEach(id => actor.disconnect(id));
        if (record.effect && actor.get_effect(EFFECT) === record.effect)
            actor.remove_effect(record.effect);
        if (record.appliedStyle !== undefined && actor.get_style() === record.appliedStyle)
            actor.set_style(record.style);
        this._actors.delete(actor);
    }

    _clear() {
        this._enabled = false;
        if (this._syncId)
            GLib.source_remove(this._syncId);
        this._syncId = 0;
        this._signals.forEach(([object, id]) => object.disconnect(id));
        this._signals = [];
        if (this._dtp)
            this._dtp.disconnect(this._dtpId);
        this._dtp = null;
        for (const [actor, record] of this._actors)
            this._forget(actor, record);
    }

    destroy() {
        this._settings.disconnect(this._settingsId);
        this._clear();
    }
}
