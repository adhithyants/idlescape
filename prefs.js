import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class IdlescapePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // --- Layout Structure ---
        const page = new Adw.PreferencesPage();
        window.add(page);

        const group = new Adw.PreferencesGroup({
            title: 'General Settings',
            description: 'Configure the video screensaver behavior.'
        });
        page.add(group);

        // 1. Enable Screensaver
        const enableRow = new Adw.SwitchRow({
            title: 'Enable Screensaver',
            subtitle: 'Toggle the screensaver functionality on or off.'
        });
        settings.bind('enabled', enableRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(enableRow);

        // 2. Multi-monitor playback
        const multiMonitorRow = new Adw.SwitchRow({
            title: 'Multi-monitor playback',
            subtitle: 'Play the screensaver video on every connected monitor.'
        });
        settings.bind('multi-monitor', multiMonitorRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(multiMonitorRow);

        // 3. Fullscreen playback
        const fullscreenRow = new Adw.SwitchRow({
            title: 'Fullscreen playback',
            subtitle: 'Play the screensaver video in fullscreen mode.'
        });
        settings.bind('fullscreen', fullscreenRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(fullscreenRow);

        // 4. Idle Timeout
        const timeoutRow = new Adw.SpinRow({
            title: 'Idle Timeout (seconds)',
            subtitle: 'Duration of inactivity before the video starts.',
            adjustment: new Gtk.Adjustment({
                lower: 10,
                upper: 3600,
                step_increment: 10,
                page_increment: 60
            })
        });
        settings.bind('idle-timeout', timeoutRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(timeoutRow);

        // 5. Video File Selection (ActionRow + FileDialog)
        const videoRow = new Adw.ActionRow({
            title: 'Screensaver Video',
            subtitle: settings.get_string('video-path') || 'No video selected',
            activatable_widget: null
        });

        // Update subtitle when setting changes
        settings.connect('changed::video-path', () => {
            videoRow.subtitle = settings.get_string('video-path') || 'No video selected';
        });

        const selectButton = new Gtk.Button({
            label: 'Select File',
            valign: Gtk.Align.CENTER,
            css_classes: ['suggested-action']
        });

        selectButton.connect('clicked', () => {
            const dialog = new Gtk.FileDialog({
                title: 'Select Screensaver Video',
                modal: true
            });

            // Filters using Gio.ListStore
            const filters = new Gio.ListStore({ item_type: Gtk.FileFilter });
            
            const videoFilter = new Gtk.FileFilter();
            videoFilter.set_name('Video files');
            videoFilter.add_mime_type('video/mp4');
            videoFilter.add_mime_type('video/x-matroska');
            videoFilter.add_mime_type('video/webm');
            filters.append(videoFilter);

            const allFilter = new Gtk.FileFilter();
            allFilter.set_name('All files');
            allFilter.add_pattern('*');
            filters.append(allFilter);

            dialog.set_filters(filters);
            dialog.set_default_filter(videoFilter);

            dialog.open(window, null, (obj, res) => {
                try {
                    const file = dialog.open_finish(res);
                    if (file) {
                        const path = file.get_path();
                        settings.set_string('video-path', path);
                    }
                } catch (e) {
                    // Handle cancel or error silently
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                        console.error(`[Idlescape] File selection error: ${e.message}`);
                    }
                }
            });
        });

        videoRow.add_suffix(selectButton);
        videoRow.activatable_widget = selectButton;
        group.add(videoRow);
    }
}
