// GNOME already maintains these MPRIS proxies. Sharing them avoids another
// bus watcher, duplicate metadata requests, and any playback polling.
export class IslandMedia {
    constructor(source, changed) {
        this._source = source;
        this._changed = changed;
        this._players = new Map();
        this.current = null;
        this._sourceIds = [
            source.connect('player-added', (_source, player) => this._add(player)),
            source.connect('player-removed', (_source, player) => this._remove(player)),
        ];
        for (const player of source.players)
            this._add(player);
    }

    _add(player) {
        if (this._players.has(player))
            return;
        const id = player.connect('changed', () => this._sync(player));
        this._players.set(player, id);
        this._sync();
    }

    _remove(player) {
        const id = this._players.get(player);
        if (id)
            player.disconnect(id);
        this._players.delete(player);
        if (this.current === player)
            this.current = null;
        this._sync();
    }

    _sync(changedPlayer) {
        const players = [...this._players.keys()];
        // Keep the selected playing source stable; newly playing sources
        // take over when the current one pauses or disappears.
        if (!this.current || this.current.status !== 'Playing') {
            this.current = players.find(p => p.status === 'Playing') ??
                (this._players.has(this.current) ? this.current : players[0]) ?? null;
        }
        if (!changedPlayer || changedPlayer === this.current)
            this._emitChanged();
    }

    _emitChanged() {
        const player = this.current;
        const signature = JSON.stringify([
            player?.status, player?.trackTitle, player?.trackArtists,
            player?.trackCoverUrl, player?.canGoNext, player?.canGoPrevious,
            player?.source.title, this.count,
        ]);
        // Volume/position updates can be frequent; neither changes this UI.
        if (this._lastPlayer === player && this._lastSignature === signature)
            return;
        this._lastPlayer = player;
        this._lastSignature = signature;
        this._changed();
    }

    cycle() {
        const players = [...this._players.keys()];
        if (players.length < 2)
            return;
        this.current = players[(players.indexOf(this.current) + 1) % players.length];
        this._emitChanged();
    }

    get count() {
        return this._players.size;
    }

    destroy() {
        for (const [player, id] of this._players)
            player.disconnect(id);
        this._players.clear();
        for (const id of this._sourceIds)
            this._source.disconnect(id);
        this.current = null;
        this._changed = null;
    }
}
