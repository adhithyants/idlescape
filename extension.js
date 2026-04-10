import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

// State Machine (Phase 9)
const State = {
    ACTIVE: 0,
    IDLE: 1,
    PLAYING: 2
};

const SIGTERM = 15;
const _cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), "idlescape"]);
GLib.mkdir_with_parents(_cacheDir, 0o755);
const MPV_LOG_FILE = GLib.build_filenamev([_cacheDir, "mpv.log"]);

export default class IdlescapeExtension extends Extension {
    enable() {

        this._state = State.ACTIVE;
        this._graceTimeoutId = null;
        this._idleMonitor = null;
        
        // --- PHASE 3: Settings Binding ---
        this._settings = this.getSettings();
        this._syncSettings();
        
        this._settingsSignalIds = [
            this._settings.connect('changed::idle-timeout', () => this._onTimeoutChanged()),
            this._settings.connect('changed::video-path', () => this._syncSettings()),
            this._settings.connect('changed::enabled', () => this._onEnabledChanged()),
            this._settings.connect('changed::backend-mode', () => this._syncSettings())
        ];

        // --- PHASE 10: Lock Screen Protection ---
        try {
            this._screenShieldSignal = Main.screenShield.connect('locked-changed', () => {
                if (Main.screenShield.locked) {

                    this._onSystemActive(); // Treat lock as "active" to kill video
                } else {

                    this._onSystemActive(); 
                }
            });
        } catch (e) {
            logError(e, `[Idlescape] Could not hook into screenShield`);
        }

        // --- PHASE 5 & 6: Control Logic & Idle Detection ---
        try {
            this._setupIdleMonitor();
        } catch (e) {
            logError(e, `[Idlescape] Critical error setting up idle monitor`);
        }
    }
    
    _syncSettings() {
        this._idleTimeout = this._settings.get_int('idle-timeout');
        this._videoPath = this._settings.get_string('video-path');
        this._enabled = this._settings.get_boolean('enabled');
        this._backendMode = this._settings.get_string('backend-mode');

    }

    _onEnabledChanged() {
        this._syncSettings();
        this._removeIdleMonitor();
        if (this._enabled) {
            this._setupIdleMonitor();
        } else {
            this._onSystemActive(); // Stop video if disabled manually
        }
    }

    _onTimeoutChanged() {
        this._syncSettings();
        this._removeIdleMonitor();
        if (this._enabled) {
            this._setupIdleMonitor();
        }
    }

    _setupIdleMonitor() {
        if (!this._enabled) return;

        try {
            // PRIMARY: Core Idle Monitor
            this._idleMonitor = global.backend.get_core_idle_monitor();
            const timeoutMs = this._idleTimeout * 1000;
            
            this._idleWatchId = this._idleMonitor.add_idle_watch(timeoutMs, () => this._onSystemIdle());
            

        } catch (e) {
            // FALLBACK: DBus integration

            this._setupDBusFallback();
        }
    }

    _armActiveWatch() {
        if (!this._idleMonitor || this._activeWatchId)
            return;

        this._activeWatchId = this._idleMonitor.add_user_active_watch(() => {
            this._activeWatchId = null;
            this._onSystemActive();
        });
    }

    _setupDBusFallback() {
        this._dbusSignalId = Gio.DBus.session.signal_subscribe(
            'org.gnome.ScreenSaver',
            'org.gnome.ScreenSaver',
            'ActiveChanged',
            '/org/gnome/ScreenSaver',
            null,
            Gio.DBusSignalFlags.NONE,
            (connection, sender, path, iface, signal, parameters) => {
                const isIdleBlanked = parameters.get_child_value(0).get_boolean();
                if (isIdleBlanked) {
                    this._onSystemIdle();
                } else {
                    this._onSystemActive();
                }
            }
        );

    }

    _removeIdleMonitor() {
        if (this._idleMonitor) {
            if (this._idleWatchId) this._idleMonitor.remove_watch(this._idleWatchId);
            if (this._activeWatchId) this._idleMonitor.remove_watch(this._activeWatchId);
            this._idleWatchId = null;
            this._activeWatchId = null;
            this._idleMonitor = null;
        }

        if (this._dbusSignalId) {
            Gio.DBus.session.signal_unsubscribe(this._dbusSignalId);
            this._dbusSignalId = null;
        }
    }

    _onSystemIdle() {
        if (this._state === State.PLAYING || !this._enabled || Main.screenShield.locked) return;
        this._state = State.IDLE;
        this._armActiveWatch();
        

        
        if (this._graceTimeoutId) {
            GLib.source_remove(this._graceTimeoutId);
        }

        this._graceTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
            this._graceTimeoutId = null;
            if (this._state === State.IDLE && !Main.screenShield.locked) {
                this._startPlayback();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _onSystemActive() {
        if (this._state === State.ACTIVE) return;
        this._state = State.ACTIVE;
        

        
        if (this._graceTimeoutId) {
            GLib.source_remove(this._graceTimeoutId);
            this._graceTimeoutId = null;
        }

        this._stopPlayback();
    }
    
    // --- PHASE 7 & 8: Process Orchestration ---
    _startPlayback() {
        this._state = State.PLAYING;

        
        if (this._backendMode === 'bash') {
            this._startBashBackend();
        } else {
            this._startNativeBackend();
        }
    }
    
    _startBashBackend() {
        try {
            // Pre-flight program check
            let mpvPath = GLib.find_program_in_path('mpv');
            if (!mpvPath) {
                logError(new Error(`[Idlescape] mpv not found in PATH! (Bash backend)`));
                return;
            }

            let scriptPath = GLib.build_filenamev([this.path, 'scripts', 'screensaver.sh']);
            if (!GLib.file_test(scriptPath, GLib.FileTest.EXISTS)) {
               logError(new Error(`[Idlescape] Bash script missing: ${scriptPath}`));
               return; 
            }

            // Path check
            if (!this._videoPath || !GLib.file_test(this._videoPath, GLib.FileTest.EXISTS)) {
                logError(new Error(`[Idlescape] Video file not found or empty: ${this._videoPath}`));
                return;
            }

            this._bashProc = new Gio.Subprocess({
                argv: [scriptPath, this._videoPath],
                flags: Gio.SubprocessFlags.NONE
            });
            this._bashProc.init(null);
            this._bashProc.wait_async(null, (proc, res) => {
                try {
                    proc.wait_finish(res);
                } catch (e) {
                    logError(e, `[Idlescape] Bash backend wait failed`);
                } finally {
                    if (this._bashProc === proc)
                        this._bashProc = null;

                    if (this._state === State.PLAYING) {

                        this._state = State.ACTIVE;
                    }
                }
            });
            

        } catch(e) {
            logError(e, `[Idlescape] Failed to launch Bash backend`);
        }
    }

    _startNativeBackend(useFallback = false) {
        try {
            // Pre-flight program check
            let mpvPath = GLib.find_program_in_path('mpv');
            if (!mpvPath) {
                logError(new Error(`[Idlescape] mpv not found in PATH!`));
                return;
            }

            // Path check
            if (!this._videoPath || !GLib.file_test(this._videoPath, GLib.FileTest.EXISTS)) {
                logError(new Error(`[Idlescape] Video file not found or empty: ${this._videoPath}`));
                return;
            }

            // Multi-monitor: target primary via --fs-screen=0
            let flags = [
                mpvPath,
                '--fullscreen',
                '--loop',
                '--no-audio',
                '--fs-screen=0', 
                '--hwdec=no',
                '--dither=no',
                '--profile=fast',
                '--stop-screensaver=no',
                '--no-input-default-bindings',
                '--really-quiet',
                '--no-osc',
                '--no-osd-bar',
                `--log-file=${MPV_LOG_FILE}`
            ];

            if (!useFallback) {
                flags.push('--vo=gpu-next');

            } else {
                flags.push('--vo=dmabuf-wayland');

            }

            flags.push(this._videoPath);

            this._nativeProc = new Gio.Subprocess({
                argv: flags,
                flags: Gio.SubprocessFlags.NONE
            });
            
            this._nativeProc.init(null);


            // Detect launch crash to trigger fallback
            this._nativeProc.wait_async(null, (proc, res) => {
                try {
                    proc.wait_finish(res);
                    if (!proc.get_successful() && !useFallback) {
                        if (this._state === State.PLAYING) {
                            logError(new Error(`[Idlescape] Primary Native spawn crashed. Triggering gpu-next Fallback!`));
                            if (this._nativeProc === proc)
                                this._nativeProc = null;
                            this._startNativeBackend(true);
                            return;
                        }
                    }
                } catch(e) {
                    logError(e, `[Idlescape] Native backend wait failed`);
                }

                if (this._nativeProc === proc)
                    this._nativeProc = null;

                if (this._state === State.PLAYING) {

                    this._state = State.ACTIVE;
                }
            });
        } catch(e) {
            logError(e, `[Idlescape] Failed to launch Native backend`);
        }
    }

    _stopPlayback() {


        this._stopProcess('_bashProc', 'bash backend');
        this._stopProcess('_nativeProc', 'native mpv');
    }

    _stopProcess(procKey, label) {
        const proc = this[procKey];
        if (!proc)
            return;


        proc.send_signal(SIGTERM);

        this._stopTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            if (this[procKey] === proc && proc.get_identifier() !== null) {

                proc.force_exit();
            }

            this._stopTimeoutId = null;
            return GLib.SOURCE_REMOVE;
        });
    }

    disable() {

        
        // --- PHASE 11: Cleanup & Reload Zombie Safety ---
        try {
            if (this._stopTimeoutId) {
                GLib.source_remove(this._stopTimeoutId);
                this._stopTimeoutId = null;
            }

            if (this._graceTimeoutId) {
                GLib.source_remove(this._graceTimeoutId);
                this._graceTimeoutId = null;
            }

            // Unhook lockscreen
            if (this._screenShieldSignal) {
                Main.screenShield.disconnect(this._screenShieldSignal);
                this._screenShieldSignal = null;
            }

            this._onSystemActive(); // Force stop video gracefully
            this._removeIdleMonitor();

            if (this._settings) {
                this._settingsSignalIds.forEach(id => this._settings.disconnect(id));
                this._settings = null;
            }
        } catch (e) {
            logError(e, `[Idlescape] Issue during teardown cleanup`);
        }
    }
}
