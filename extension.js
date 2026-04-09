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

export default class IdlescapeExtension extends Extension {
    enable() {
        console.log(`[Idlescape] Extension enabled`);
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
                    console.log(`[Idlescape] Screen locked. Suppressing video playback.`);
                    this._onSystemActive(); // Treat lock as "active" to kill video
                } else {
                    console.log(`[Idlescape] Screen unlocked. Resetting idle state.`);
                    this._onSystemActive(); 
                }
            });
        } catch (e) {
            console.error(`[Idlescape] Could not hook into screenShield (Lockscreen API changed?) ${e}`);
        }

        // --- PHASE 5 & 6: Control Logic & Idle Detection ---
        try {
            this._setupIdleMonitor();
        } catch (e) {
            console.error(`[Idlescape] Critical error setting up idle monitor: ${e}`);
        }
    }
    
    _syncSettings() {
        this._idleTimeout = this._settings.get_int('idle-timeout');
        this._videoPath = this._settings.get_string('video-path');
        this._enabled = this._settings.get_boolean('enabled');
        this._backendMode = this._settings.get_string('backend-mode');
        console.log(`[Idlescape] Settings bound: [timeout: ${this._idleTimeout}] [mode: ${this._backendMode}]`);
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
            this._activeWatchId = this._idleMonitor.add_user_active_watch(() => this._onSystemActive());
            
            console.log(`[Idlescape] Primary Idle Monitor engaged (${this._idleTimeout}s). No polling loops used.`);
        } catch (e) {
            // FALLBACK: DBus integration
            console.warn(`[Idlescape] Primary monitor failed, reverting to DBus fallback: ${e}`);
            this._setupDBusFallback();
        }
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
        console.log(`[Idlescape] DBus screen-saver fallback engaged.`);
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
        if (this._state === State.PLAYING || !this._enabled) return;
        this._state = State.IDLE;
        
        console.log(`[Idlescape] User idle detected. Waiting 1.5s grace period to completely avoid micro-flickering.`);
        
        if (this._graceTimeoutId) {
            GLib.source_remove(this._graceTimeoutId);
        }

        this._graceTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
            this._graceTimeoutId = null;
            if (this._state === State.IDLE) {
                this._startPlayback();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _onSystemActive() {
        if (this._state === State.ACTIVE) return;
        this._state = State.ACTIVE;
        
        console.log(`[Idlescape] User active. Disrupting idle state.`);
        
        if (this._graceTimeoutId) {
            GLib.source_remove(this._graceTimeoutId);
            this._graceTimeoutId = null;
        }

        this._stopPlayback();
    }
    
    // --- PHASE 7 & 8: Process Orchestration ---
    _startPlayback() {
        this._state = State.PLAYING;
        console.log(`[Idlescape] Initiating Backend Mode: ${this._backendMode}`);
        
        if (this._backendMode === 'bash') {
            this._startBashBackend();
        } else {
            this._startNativeBackend();
        }
    }
    
    _startBashBackend() {
        try {
            let scriptPath = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'screensaver.sh']);
            if (!GLib.file_test(scriptPath, GLib.FileTest.EXISTS)) {
               console.error(`[Idlescape] Bash script missing: ${scriptPath}`);
               return; 
            }

            this._bashProc = new Gio.Subprocess({
                argv: [scriptPath],
                flags: Gio.SubprocessFlags.NONE
            });
            this._bashProc.init(null);
            
            console.log(`[Idlescape] Bash Script spawned with PID: ${this._bashProc.get_identifier()}`);
        } catch(e) {
            console.error(`[Idlescape] Failed to launch Bash backend: ${e}`);
        }
    }

    _startNativeBackend(useFallback = false) {
        try {
            // Pre-flight program check
            let mpvPath = GLib.find_program_in_path('mpv');
            if (!mpvPath) {
                console.error(`[Idlescape] mpv not found in PATH!`);
                return;
            }

            // Path check
            if (!this._videoPath || !GLib.file_test(this._videoPath, GLib.FileTest.EXISTS)) {
                console.error(`[Idlescape] Video file not found or empty: ${this._videoPath}`);
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
                '--profile=fast'
            ];

            if (!useFallback) {
                flags.push('--vo=dmabuf-wayland');
                console.log(`[Idlescape] Native Mode: Using primary dmabuf-wayland flags`);
            } else {
                flags.push('--vo=gpu-next');
                console.warn(`[Idlescape] Native Mode: Using fallback gpu-next flags`);
            }

            flags.push(this._videoPath);

            this._nativeProc = new Gio.Subprocess({
                argv: flags,
                flags: Gio.SubprocessFlags.NONE
            });
            
            this._nativeProc.init(null);
            console.log(`[Idlescape] Native MPV spawned with PID: ${this._nativeProc.get_identifier()}`);

            // Detect launch crash to trigger fallback
            this._nativeProc.wait_async(null, (proc, res) => {
                try {
                    proc.wait_finish(res);
                    if (!proc.get_successful() && !useFallback) {
                        if (this._state === State.PLAYING) {
                            console.error(`[Idlescape] Primary Native spawn crashed. Triggering gpu-next Fallback!`);
                            this._startNativeBackend(true);
                        }
                    }
                } catch(e) {}
            });
        } catch(e) {
            console.error(`[Idlescape] Failed to launch Native backend: ${e}`);
        }
    }

    _stopPlayback() {
        console.log(`[Idlescape] Terminating video subprocesses...`);
        
        if (this._bashProc) {
            console.log(`[Idlescape] Terminating Bash Process [PID: ${this._bashProc.get_identifier()}]`);
            this._bashProc.force_exit();
            this._bashProc = null;
        }

        if (this._nativeProc) {
            console.log(`[Idlescape] Terminating Native MPV [PID: ${this._nativeProc.get_identifier()}]`);
            this._nativeProc.force_exit();
            this._nativeProc = null;
        }
    }

    disable() {
        console.log(`[Idlescape] Extension completely disabled`);
        
        // --- PHASE 11: Cleanup & Reload Zombie Safety ---
        try {
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
            console.error(`[Idlescape] Issue during teardown cleanup: ${e}`);
        }
    }
}
