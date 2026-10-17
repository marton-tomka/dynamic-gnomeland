import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

// A playback-state indicator, not an audio analyser. The compositor animates
// these transforms; no audio capture, sampling loop, or JavaScript frame timer.
export class Waveform {
    constructor() {
        this.actor = new St.BoxLayout({style_class: 'dyno-wave', y_align: Clutter.ActorAlign.CENTER});
        this._bars = [];
        this._playing = false;
        this._running = false;
        this._exposed = true;
        for (let i = 0; i < 5; i++) {
            const bar = new St.Widget({style_class: 'dyno-wave-bar', y_align: Clutter.ActorAlign.CENTER});
            bar.set_pivot_point(0.5, 0.5);
            this.actor.add_child(bar);
            this._bars.push(bar);
        }
        this.actor.connect('notify::mapped', () => this._sync());
        this._settings = St.Settings.get();
        this._settingsId = this._settings.connect('notify::enable-animations', () => this._sync());
        this._sync();
    }

    setPlaying(playing) {
        this._playing = playing;
        this._sync();
    }

    setExposed(exposed) {
        this._exposed = exposed;
        this._sync();
    }

    _sync() {
        if (this._disposed)
            return;
        const canAnimate = this._exposed && this.actor.mapped && this._settings.enable_animations;
        const running = this._playing && canAnimate;
        if (running === this._running && this._playing === this._lastPlaying &&
            canAnimate === this._canAnimate && this._initialized)
            return;
        const settle = this._initialized && !this._playing && canAnimate;
        this._initialized = true;
        this._running = running;
        this._lastPlaying = this._playing;
        this._canAnimate = canAnimate;
        const rests = [0.30, 0.62, 0.95, 0.56, 0.35];
        this._bars.forEach((bar, i) => {
            bar.remove_all_transitions();
            if (running)
                bar.scale_y = rests[i];
            else if (!settle) {
                bar.scale_y = this._playing ? rests[i] : 2 / 13;
                return;
            }
            if (running || Math.abs(bar.scale_y - 2 / 13) > 0.001) {
                // Shell's ease() holds begin_work() and disables unredirect
                // until completion. An endless status animation must not hold
                // either lock: use the native transition directly.
                const transition = new Clutter.PropertyTransition({
                    property_name: 'scale-y',
                    interval: new Clutter.Interval({value_type: GObject.TYPE_DOUBLE}),
                    duration: running ? 440 + i * 115 : 200,
                    repeat_count: running ? -1 : 0, auto_reverse: running,
                    remove_on_complete: !running,
                    progress_mode: running ? Clutter.AnimationMode.EASE_IN_OUT_SINE
                        : Clutter.AnimationMode.EASE_OUT_CUBIC,
                });
                transition.set_from(bar.scale_y);
                transition.set_to(running ? (i % 2 ? 0.25 : 0.88) : 2 / 13);
                bar.add_transition('dyno-wave', transition);
            }
        });
    }

    destroy() {
        this._disposed = true;
        this._settings.disconnect(this._settingsId);
        for (const bar of this._bars)
            bar.remove_all_transitions();
        this.actor.destroy();
    }
}
