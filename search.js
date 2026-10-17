import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';

// Borrow providers, not the overview's results widget: its activation opens
// the overview and its lifetime is the entire Shell session.
export class IslandSearch {
    constructor(changed) {
        this._changed = changed;
        this._serial = 0;
        this._timer = 0;
        this._cancellable = null;
        this.query = '';
        this.results = [];
        this.pending = false;
        this._disposed = false;
    }

    setQuery(query) {
        query = query.trim();
        if (query === this.query)
            return;
        this.cancel();
        this.query = query;
        this.results = [];
        this.pending = Boolean(query);
        this._changed();
        if (query) {
            this._timer = GLib.timeout_add_once(GLib.PRIORITY_DEFAULT, 70, () => {
                this._timer = 0;
                this._run();
            });
        }
    }

    flush() {
        if (this._timer) {
            GLib.source_remove(this._timer);
            this._timer = 0;
            this._run();
        }
    }

    _run() {
        if (!this.query || this._disposed)
            return;
        const serial = this._serial;
        const terms = this.query.split(/\s+/);
        const providers = Main.overview._overview.controls.searchController
            ._searchResults._providers.slice();
        const batches = new Array(providers.length).fill(null);
        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;
        let remaining = providers.length;
        if (!remaining) {
            this.pending = false;
            this._changed();
        }
        providers.forEach(async (provider, index) => {
            try {
                const ids = await provider.getInitialResultSet(terms, cancellable);
                if (cancellable.is_cancelled() || serial !== this._serial)
                    return;
                if (!ids.length)
                    return;
                const limit = provider.isRemoteProvider ? 2 : 5;
                const metas = await provider.getResultMetas(ids.slice(0, limit), cancellable);
                if (cancellable.is_cancelled() || serial !== this._serial)
                    return;
                batches[index] = metas.map(meta => ({
                    key: `${provider.id}:${meta.id}`, provider, meta, terms,
                }));
            } catch (error) {
                if (!cancellable.is_cancelled())
                    console.debug(`Dyno: search provider ${provider.id}: ${error.message}`);
            } finally {
                if (!this._disposed && serial === this._serial) {
                    this.pending = --remaining > 0;
                    this.results = batches.flatMap(batch => batch ?? []).slice(0, 8);
                    this._changed();
                }
            }
        });
    }

    activate(result) {
        if (!result)
            return;
        const {provider, meta, terms} = result;
        if (provider.id === 'applications') {
            if (meta.id.endsWith('.desktop'))
                Shell.AppSystem.get_default().lookup_app(meta.id)?.activate();
            else
                SystemActions.getDefault().activateAction(meta.id);
        } else {
            provider.activateResult(meta.id, terms);
        }
        if (meta.clipboardText)
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, meta.clipboardText);
    }

    cancel() {
        this._serial++;
        if (this._timer)
            GLib.source_remove(this._timer);
        this._timer = 0;
        this._cancellable?.cancel();
        this._cancellable = null;
        this.pending = false;
    }

    reset() {
        this.cancel();
        this.query = '';
        this.results = [];
    }

    destroy() {
        this._disposed = true;
        this.reset();
        this._changed = null;
    }
}
