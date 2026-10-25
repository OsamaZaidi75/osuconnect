import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { TieredDiskStorage } from './tiered-disk-storage';

type Info = Partial<Express.Multer.File>;

function upload(storage: TieredDiskStorage, content = 'hello'): Promise<Info> {
  const file = {
    stream: Readable.from([Buffer.from(content)]),
  } as unknown as Express.Multer.File;
  const req = { headers: { 'content-length': String(content.length) } };
  return new Promise((resolve, reject) => {
    storage._handleFile(req as never, file, (error, info) =>
      error ? reject(error as Error) : resolve(info as Info),
    );
  });
}

describe('TieredDiskStorage', () => {
  let root: string;
  let primary: string;
  let fallback: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'tiered-'));
    primary = join(root, 'primary');
    fallback = join(root, 'fallback');
    await fs.mkdir(primary);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const build = (overrides = {}) =>
    new TieredDiskStorage({
      primaryDir: primary,
      fallbackDir: fallback,
      primaryMarker: '.marker',
      minFreeBytes: 0,
      downMs: 0,
      ...overrides,
    });

  it('writes to the primary when it is healthy', async () => {
    await fs.writeFile(join(primary, '.marker'), '');

    const info = await upload(build());

    expect(info.destination).toBe(primary);
    expect(info.path?.startsWith(primary)).toBe(true);
    expect(await fs.readFile(info.path!, 'utf8')).toBe('hello');
    expect(info.size).toBe(5);
  });

  it('falls back when the primary marker is missing (share not mounted)', async () => {
    const info = await upload(build());

    expect(info.destination).toBe(fallback);
    expect(await fs.readFile(info.path!, 'utf8')).toBe('hello');
    expect(await fs.readdir(primary)).toEqual([]);
  });

  it('falls back when the primary has too little free space', async () => {
    await fs.writeFile(join(primary, '.marker'), '');

    const info = await upload(build({ minFreeBytes: Number.MAX_SAFE_INTEGER }));

    expect(info.destination).toBe(fallback);
  });

  it('returns to the primary once it becomes healthy again', async () => {
    const storage = build();
    expect((await upload(storage)).destination).toBe(fallback);

    await fs.writeFile(join(primary, '.marker'), '');

    expect((await upload(storage)).destination).toBe(primary);
  });

  it('skips the primary for downMs after a failure', async () => {
    const storage = build({ downMs: 60_000 });
    expect((await upload(storage)).destination).toBe(fallback);

    await fs.writeFile(join(primary, '.marker'), '');

    expect((await upload(storage)).destination).toBe(fallback);
  });

  it('removes a stored file', async () => {
    const info = await upload(build());

    await new Promise<void>((resolve, reject) =>
      build()._removeFile({} as never, info as Express.Multer.File, (error) =>
        error ? reject(error) : resolve(),
      ),
    );

    await expect(fs.access(info.path!)).rejects.toThrow();
  });
});
