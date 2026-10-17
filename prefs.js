import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class DynoPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.set_default_size(540, 320);
        const page = new Adw.PreferencesPage({title: 'Appearance', icon_name: 'preferences-desktop-appearance-symbolic'});
        const group = new Adw.PreferencesGroup({title: 'Top bar'});
        const row = new Adw.SwitchRow({
            title: 'Dark panel icons',
            subtitle: 'Use dark status icons and text on the right side for light wallpapers.',
        });
        group.add(row);
        page.add(group);
        window.add(page);
        window._settings = this.getSettings();
        window._settings.bind('dark-panel-icons', row, 'active', Gio.SettingsBindFlags.DEFAULT);
    }
}
