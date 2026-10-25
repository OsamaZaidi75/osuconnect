import { Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { createWriteStream, promises as fs } from 'fs';
import { join } from 'path';
import type { Request } from 'express';
import type { StorageEngine } from 'multer';

export interface TieredStorageOptions {
  /** Preferred location (e.g. the Azure Files mount). */
  primaryDir: string;
  /** Used whenever the primary is unavailable or too full. */
  fallbackDir: string;
  /**
   * File that must exist directly inside primaryDir. Guards against an
   * unmounted network share leaving an empty local directory that would
   * silently swallow uploads on the wrong disk.
   */
  primaryMarker?: string;
  /** Free space that must remain on the primary after the upload. */
  minFreeBytes?: number;
  /** How long a failed primary is skipped before it is probed again. */
  downMs?: number;
  /** Max time a primary probe may take (a hung mount must not hang uploads). */
  probeTimeoutMs?: number;
}

const WRITE_PROBE_INTERVAL_MS = 10_000;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timed out after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Multer storage engine that writes each upload to the primary directory
 * when it is healthy and has room, and to the fallback directory otherwise.
 *
 * The stored key is the absolute file path, so reads and deletes work no
 * matter which directory a file ended up in.
 */
export class TieredDiskStorage implements StorageEngine {
  private readonly logger = new Logger(TieredDiskStorage.name);
  private readonly minFreeBytes: number;
  private readonly downMs: number;
  private readonly probeTimeoutMs: number;
  private downUntil = 0;
  private lastWriteProbe = 0;
  private primaryWasDown = false;

  constructor(private readonly options: TieredStorageOptions) {
    this.minFreeBytes = options.minFreeBytes ?? 1024 * 1024 * 1024;
    this.downMs = options.downMs ?? 30_000;
    this.probeTimeoutMs = options.probeTimeoutMs ?? 5_000;
  }

  _handleFile(
    req: Request,
    file: Express.Multer.File,
    callback: (error?: unknown, info?: Partial<Express.Multer.File>) => void,
  ): void {
    const needed = Number(req.headers['content-length']) || 0;

    this.chooseDirectory(needed).then((dir) => {
      const filename = randomBytes(16).toString('hex');
      const path = join(dir, filename);
      const out = createWriteStream(path);

      out.on('error', (error) => {
        if (dir === this.options.primaryDir) this.markPrimaryDown(error);
        file.stream.unpipe(out);
        out.destroy();
        fs.unlink(path).catch(() => undefined);
        callback(error);
      });
      out.on('finish', () =>
        callback(null, {
          destination: dir,
          filename,
          path,
          size: out.bytesWritten,
        }),
      );
      file.stream.pipe(out);
    }, callback);
  }

  _removeFile(
    _req: Request,
    file: Express.Multer.File,
    callback: (error: Error | null) => void,
  ): void {
    fs.unlink(file.path).then(
      () => callback(null),
      (error: NodeJS.ErrnoException) =>
        callback(error.code === 'ENOENT' ? null : error),
    );
  }

  private async chooseDirectory(neededBytes: number): Promise<string> {
    if (await this.primaryUsable(neededBytes)) {
      return this.options.primaryDir;
    }
    await fs.mkdir(this.options.fallbackDir, { recursive: true });
    return this.options.fallbackDir;
  }

  private async primaryUsable(neededBytes: number): Promise<boolean> {
    const now = Date.now();
    if (now < this.downUntil) return false;

    try {
      await withTimeout(this.probe(neededBytes, now), this.probeTimeoutMs);
      if (this.primaryWasDown) {
        this.primaryWasDown = false;
        this.logger.log('Primary upload storage is back, using it again');
      }
      return true;
    } catch (error) {
      this.markPrimaryDown(error);
      return false;
    }
  }

  private async probe(neededBytes: number, now: number): Promise<void> {
    const { primaryDir, primaryMarker } = this.options;

    if (primaryMarker) {
      await fs.access(join(primaryDir, primaryMarker));
    } else {
      await fs.mkdir(primaryDir, { recursive: true });
    }

    const stats = await fs.statfs(primaryDir);
    const free = Number(stats.bavail) * Number(stats.bsize);
    if (free < neededBytes + this.minFreeBytes) {
      throw new Error(`low on space (${Math.floor(free / 1048576)} MB free)`);
    }

    if (now - this.lastWriteProbe >= WRITE_PROBE_INTERVAL_MS) {
      const probeFile = join(primaryDir, `.probe-${process.pid}`);
      await fs.writeFile(probeFile, 'ok');
      await fs.unlink(probeFile);
      this.lastWriteProbe = now;
    }
  }

  private markPrimaryDown(error: unknown): void {
    this.downUntil = Date.now() + this.downMs;
    this.lastWriteProbe = 0;
    if (!this.primaryWasDown) {
      this.primaryWasDown = true;
      this.logger.warn(
        `Primary upload storage unavailable (${error instanceof Error ? error.message : String(error)}); using the fallback`,
      );
    }
  }
}
