import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class IdlescapePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const page = new Adw.PreferencesPage();
        window.add(page);

        const group = new Adw.PreferencesGroup({
            title: 'Idlescape Settings',
            description: 'Configure the Wayland-compatible video screensaver.'
        });
        page.add(group);

        const settings = this.getSettings();

        // 1. Enable/Disable SwitchRow
        const enableRow = new Adw.SwitchRow({ title: 'Enable Screensaver' });
        settings.bind('enabled', enableRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(enableRow);

        // 2. Idle Timeout SpinRow
        const timeoutRow = new Adw.SpinRow({
            title: 'Idle Timeout (seconds)',
            adjustment: new Gtk.Adjustment({ lower: 5, upper: 3600, step_increment: 5 })
        });
        settings.bind('idle-timeout', timeoutRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(timeoutRow);

        // 3. Video Path EntryRow
        const pathRow = new Adw.EntryRow({ title: 'Absolute Video Path' });
        settings.bind('video-path', pathRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        group.add(pathRow);

        // 4. Backend Mode ComboRow
        const model = Gtk.StringList.new(['Bash (Stable)', 'Native GJS (Experimental)']);
        const backendRow = new Adw.ComboRow({
            title: 'Backend Mode',
            model: model
        });
        
        // Sync combo row with settings string
        const updateCombo = () => {
            const val = settings.get_string('backend-mode');
            backendRow.selected = (val === 'native') ? 1 : 0;
        };
        updateCombo();
        
        backendRow.connect('notify::selected', () => {
            const newVal = backendRow.selected === 1 ? 'native' : 'bash';
            settings.set_string('backend-mode', newVal);
        });
        settings.connect('changed::backend-mode', updateCombo);

        group.add(backendRow);
    }
}
