import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export async function createMockTray(iconPath) {
    const name = 'org.kde.StatusNotifierItem.DynoTest';
    const item = {
        Category: 'ApplicationStatus', Id: 'dyno-test-tray', Title: 'Detailed tray fixture',
        Status: 'Active', WindowId: 0, Menu: '/NO_DBUSMENU', ItemIsMenu: false,
        IconThemePath: '', IconName: iconPath, IconPixmap: [],
        OverlayIconName: '', OverlayIconPixmap: [],
        AttentionIconName: '', AttentionIconPixmap: [], AttentionMovieName: '',
        Activate() {}, SecondaryActivate() {}, ContextMenu() {}, Scroll() {},
    };
    const properties = Object.entries({
        Category: 's', Id: 's', Title: 's', Status: 's', WindowId: 'i', Menu: 'o', ItemIsMenu: 'b',
        IconThemePath: 's', IconName: 's', IconPixmap: 'a(iiay)', OverlayIconName: 's',
        OverlayIconPixmap: 'a(iiay)', AttentionIconName: 's', AttentionIconPixmap: 'a(iiay)', AttentionMovieName: 's',
    }).map(([key, type]) => `<property name="${key}" type="${type}" access="read"/>`).join('');
    const exported = Gio.DBusExportedObject.wrapJSObject(`<node><interface name="org.kde.StatusNotifierItem">
        ${properties}<signal name="NewIcon"/><signal name="NewStatus"><arg type="s"/></signal>
        <method name="Activate"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
        <method name="SecondaryActivate"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
        <method name="ContextMenu"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
        <method name="Scroll"><arg type="i" direction="in"/><arg type="s" direction="in"/></method>
        </interface></node>`, item);
    exported.export(Gio.DBus.session, '/StatusNotifierItem');
    let owner;
    await new Promise(resolve => {
        owner = Gio.bus_own_name_on_connection(Gio.DBus.session, name, Gio.BusNameOwnerFlags.NONE, resolve, null);
    });
    await new Promise((resolve, reject) => Gio.DBus.session.call('org.kde.StatusNotifierWatcher', '/StatusNotifierWatcher',
        'org.kde.StatusNotifierWatcher', 'RegisterStatusNotifierItem', new GLib.Variant('(s)', [name]), null,
        Gio.DBusCallFlags.NONE, 4000, null, (connection, result) => {
            try { connection.call_finish(result); resolve(); } catch (error) { reject(error); }
        }));
    return {
        changeIcon(path) {
            item.IconName = path;
            exported.emit_property_changed('IconName', new GLib.Variant('s', path));
            exported.emit_signal('NewIcon', null);
        },
        destroy() {
            Gio.bus_unown_name(owner);
            exported.unexport();
        },
    };
}
