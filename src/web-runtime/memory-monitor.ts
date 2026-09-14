// browser/src/memory-monitor.ts
import { EventEmitter } from 'events';

export class MemoryPressureMonitor extends EventEmitter {
  private interval: NodeJS.Timeout | null = null;
  private _level: 'normal' | 'warning' | 'critical' = 'normal';
  private threshold: { warningMb: number; criticalMb: number };

  constructor(threshold: { warningMb: number; criticalMb: number }) {
    super();
    this.threshold = threshold;
  }

  get currentLevel() {
    return this._level;
  }

  start() {
    this.interval = setInterval(() => this.check(), 5000);
    this.interval.unref();
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private check() {
    // Approximate available memory
    // On Linux/macOS, use /proc/meminfo or sysinfo; fallback to process RSS heuristic
    const level = this.estimateLevel();

    if (level !== this._level) {
      this._level = level;
      this.emit(level, { availableMb: this.estimateAvailableMb() });
    }
  }

  private estimateLevel(): 'normal' | 'warning' | 'critical' {
    const availableMb = this.estimateAvailableMb();
    if (availableMb < this.threshold.criticalMb) return 'critical';
    if (availableMb < this.threshold.warningMb) return 'warning';
    return 'normal';
  }

  private estimateAvailableMb(): number {
    try {
      // Linux: /proc/meminfo
      if (process.platform === 'linux') {
        const fs = require('fs');
        const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
        const match = meminfo.match(/MemAvailable:\s+(\d+) kB/);
        if (match) {
          return Math.round(parseInt(match[1], 10) / 1024);
        }
      }
      // macOS: sysctl
      if (process.platform === 'darwin') {
        const { execSync } = require('child_process');
        const out = execSync('sysctl -n hw.memsize').toString().trim();
        const total = parseInt(out, 10) / 1024 / 1024;
        // Heuristic: assume 30% is used by system
        return Math.round(total * 0.45);
      }
      // Windows / fallback: use process RSS as proxy
      return Math.round(process.memoryUsage().rss / 1024 / 1024) * -1 + 4096;
    } catch {
      return 4096; // assume enough
    }
  }
}