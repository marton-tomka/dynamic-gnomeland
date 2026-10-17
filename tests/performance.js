import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {createMockMedia} from './mock-media.js';

const decode = new TextDecoder();
const out = GLib.getenv('DYNO_TEST_OUTPUT') ?? '/tmp/dyno-tests';
GLib.mkdir_with_parents(out, 0o755);
function proc() {
    const [, statBytes] = GLib.file_get_contents('/proc/self/stat');
    const stat = decode.decode(statBytes);
    const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
    const [, statusBytes] = GLib.file_get_contents('/proc/self/status');
    const status = decode.decode(statusBytes);
    return {ticks: Number(fields[11]) + Number(fields[12]), rssKiB: Number(status.match(/VmRSS:\s+(\d+)/)[1])};
}
const rounded = n => Math.round(n * 1000) / 1000;
function distribution(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    return {samples: sorted.length, median: rounded(sorted[Math.floor(sorted.length / 2)] ?? 0),
        p95: rounded(sorted[Math.floor(sorted.length * 0.95)] ?? 0), max: rounded(sorted.at(-1) ?? 0)};
}
export async function run() {
    Main.overview.hide();
    // Let the isolated desktop finish service/font startup before measuring.
    await Scripting.sleep(5000);
    const instance = Main.extensionManager.lookup('dyno@local')?.stateObj;
    if (!instance?._surface)
        throw new Error('Dyno is not enabled');
    const mock = createMockMedia();
    await Scripting.sleep(300);
    instance._surface.open();
    await Scripting.sleep(300);
    instance._surface.close(false);
    mock.player.PlayPause();
    await Scripting.sleep(300);
    instance.disable();
    System.gc();
    await Scripting.sleep(500);

    let paintCount = 0;
    let measuring = false;
    let lastPaint = 0;
    let start = 0;
    let firstPaint = false;
    const intervals = [];
    const firstPaintLatencies = [];
    const handler = global.stage.connect('after-paint', () => {
        paintCount++;
        if (!measuring)
            return;
        const now = GLib.get_monotonic_time();
        if (firstPaint) {
            firstPaintLatencies.push((now - start) / 1000);
            firstPaint = false;
        }
        if (lastPaint)
            intervals.push((now - lastPaint) / 1000);
        lastPaint = now;
    });
    const idle = async () => {
        // Keep the test helper alive during longer measurement runs.
        await Scripting.waitTestWindows();
        const before = proc();
        const frames = paintCount;
        const from = GLib.get_monotonic_time();
        await Scripting.sleep(4000);
        const elapsedSeconds = (GLib.get_monotonic_time() - from) / 1e6;
        const after = proc();
        return {seconds: rounded(elapsedSeconds), shellCpuPercent: rounded((after.ticks - before.ticks) / elapsedSeconds),
            shellPaints: paintCount - frames, shellRssKiB: after.rssKiB};
    };
    const baseline = await idle();
    instance.enable();
    System.gc();
    await Scripting.sleep(500);
    const enabled = await idle();
    mock.player.PlayPause();
    await Scripting.sleep(400);
    const playingWaveform = await idle();
    const surface = instance._surface;
    const openingWork = [];
    for (let i = 0; i < 12; i++) {
        lastPaint = 0;
        firstPaint = true;
        measuring = true;
        start = GLib.get_monotonic_time();
        surface.open();
        openingWork.push((GLib.get_monotonic_time() - start) / 1000);
        await Scripting.sleep(290);
        measuring = false;
        lastPaint = 0;
        measuring = true;
        surface.close();
        await Scripting.sleep(240);
        measuring = false;
    }
    await Scripting.sleep(600);
    if (surface.isOpen || surface.actor.visible || surface.search._timer || instance._captureTimer ||
        instance._workspaceTimer || instance._audioTimer || instance._eventTimer || surface._grab)
        throw new Error('Idle cleanup invariant failed');
    if (intervals.length < 50)
        throw new Error('Insufficient painted animation frames');
    mock.player.PlayPause();
    System.gc();
    await Scripting.sleep(1500);
    const afterCycles = await idle();
    global.stage.disconnect(handler);
    const result = {
        environment: 'GNOME 50.1, isolated headless Wayland, 1280×720, forced animations, shared Intel GPU',
        note: 'CPU and RSS are whole-Shell observations, not isolated extension attribution. Linux CLK_TCK=100. Short idle samples have limited resolution.',
        baseline, enabled, playingWaveform, afterCycles,
        openingSynchronousWorkMs: distribution(openingWork),
        openingToFirstPaintMs: distribution(firstPaintLatencies),
        animationPaintIntervalMs: distribution(intervals),
        idleCleanupPassed: true,
    };
    GLib.file_set_contents(`${out}/performance.json`, JSON.stringify(result, null, 2));
    print(`DYNO PERFORMANCE: ${JSON.stringify(result)}`);
    mock.destroy();
    instance.disable();
}
