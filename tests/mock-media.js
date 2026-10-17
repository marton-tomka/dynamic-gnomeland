import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export function createMockMedia() {
    const calls = {playPause: 0, previous: 0, next: 0, raise: 0};
    const player = {
        PlaybackStatus: 'Playing', CanPlay: true, CanPause: true,
        CanControl: true, CanGoNext: true, CanGoPrevious: true,
        CanSeek: false, Position: 0, Volume: 0.8,
        Metadata: {
            'mpris:trackid': new GLib.Variant('o', '/dyno/test/track'),
            'xesam:title': new GLib.Variant('s', 'Late night / live session'),
            'xesam:artist': new GLib.Variant('as', ['Studio Session']),
        },
        PlayPause() {
            calls.playPause++;
            this.PlaybackStatus = this.PlaybackStatus === 'Playing' ? 'Paused' : 'Playing';
            playerExport.emit_property_changed('PlaybackStatus', new GLib.Variant('s', this.PlaybackStatus));
        },
        Next() { calls.next++; },
        Previous() { calls.previous++; },
    };
    const properties = Object.entries({
        PlaybackStatus: 's', CanPlay: 'b', CanPause: 'b', CanControl: 'b',
        CanGoNext: 'b', CanGoPrevious: 'b', CanSeek: 'b', Position: 'x',
        Volume: 'd', Metadata: 'a{sv}',
    }).map(([name, type]) => `<property name="${name}" type="${type}" access="read"/>`).join('');
    const playerExport = Gio.DBusExportedObject.wrapJSObject(
        `<node><interface name="org.mpris.MediaPlayer2.Player">${properties}<method name="PlayPause"/><method name="Next"/><method name="Previous"/></interface></node>`, player);
    const rootExport = Gio.DBusExportedObject.wrapJSObject(
        '<node><interface name="org.mpris.MediaPlayer2"><property name="Identity" type="s" access="read"/><property name="DesktopEntry" type="s" access="read"/><property name="CanRaise" type="b" access="read"/><method name="Raise"/></interface></node>',
        {Identity: 'Test video player', DesktopEntry: '', CanRaise: true, Raise() { calls.raise++; }});
    rootExport.export(Gio.DBus.session, '/org/mpris/MediaPlayer2');
    playerExport.export(Gio.DBus.session, '/org/mpris/MediaPlayer2');
    const owner = Gio.bus_own_name_on_connection(Gio.DBus.session,
        'org.mpris.MediaPlayer2.DynoTest', Gio.BusNameOwnerFlags.NONE, null, null);
    return {
        calls, player,
        setPlayback(status) {
            player.PlaybackStatus = status;
            playerExport.emit_property_changed('PlaybackStatus', new GLib.Variant('s', status));
        },
        setArtwork(uri) {
            player.Metadata['mpris:artUrl'] = new GLib.Variant('s', uri);
            playerExport.emit_property_changed('Metadata', new GLib.Variant('a{sv}', player.Metadata));
        },
        changeVolume(value) {
            player.Volume = value;
            playerExport.emit_property_changed('Volume', new GLib.Variant('d', value));
        },
        destroy() {
            Gio.bus_unown_name(owner);
            playerExport.unexport();
            rootExport.unexport();
        },
    };
}
