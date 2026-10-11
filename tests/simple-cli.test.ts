import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const exec = promisify(execFile);
describe('installed simple generation workflow', () => {
  it('runs independently with automatic keys, exact resume, direct options and doctor', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wowidea-simple-cli-'));
    let posts = 0, malformed = false; const payloads: any[] = [];
    const server = createServer((req, res) => {
      const base = `http://127.0.0.1:${(server.address() as any).port}`;
      if (req.url === '/image.png') { res.end('downloaded-bytes'); return; }
      res.setHeader('Content-Type', 'application/json');
      if (req.headers.authorization !== 'Bearer fake-test-key') { res.writeHead(401); res.end('{}'); return; }
      if (malformed && req.url === '/api/v1/models') { res.end('<html>login</html>'); return; }
      if (req.url === '/api/v1/models') { res.end(JSON.stringify({ data: [
        { id: 'Nano Banana 2', capabilities: { image_generate: { output_resolutions: ['4K'], aspect_ratio_allowed: ['1:1'] } } },
        { id: 'Wan3.0-Video', capabilities: { omni_video: { supported_modes: ['text_to_video'], output_resolutions: ['480p'], aspect_ratio_allowed: ['16:9'], duration_range: [2, 30], output_audio: true } } },
      ] })); return; }
      if (req.url === '/api/v1/balance') { res.end('{"total":100}'); return; }
      if (req.url?.startsWith('/api/v1/tasks?') || req.url === '/api/v1/tasks') { res.end('{"items":[]}'); return; }
      if (req.url?.startsWith('/api/v1/tasks/')) { res.end(JSON.stringify({ taskId: req.url.split('/').pop(), status: 'succeeded', output: [`${base}/image.png`] })); return; }
      if (req.url?.endsWith('/generations') && req.method === 'POST') {
        let body = ''; req.on('data', chunk => body += chunk); req.on('end', () => { posts++; payloads.push(JSON.parse(body)); res.end(JSON.stringify({ taskId: `task-${posts}`, status: 'queued' })); }); return;
      }
      res.writeHead(404); res.end('{}');
    });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    const env = { ...process.env, WOWIDEA_API_KEY: '', EASYAI_CONFIG_DIR: join(root, 'config'), EASYAI_API_KEY: 'fake-test-key', EASYAI_ACCESS_TOKEN: '', EASYAI_BASE_URL: `http://127.0.0.1:${(server.address() as any).port}` };
    let binary = resolve('dist/cli.js');
    const run = async (...args: string[]) => JSON.parse((await exec(process.execPath, [binary, '--json', ...args], { cwd: root, env, windowsHide: true })).stdout).data;
    try {
      const setup = await run('project', 'setup', '--dir', root, '--no-canvas');
      binary = join(root, '.wowidea/runtime/dist/cli.js');
      expect(await run('doctor')).toMatchObject({ ok: true, checks: { models: { count: 2 }, balance: { ok: true }, tasks: { ok: true } } });
      if (setup.credentialRuntime.available) {
        const native = join(root, '.wowidea/runtime/node_modules/keytar');
        const loaded = await exec(process.execPath, ['-e', `console.log(typeof require(${JSON.stringify(native)}).getPassword)`], { cwd: root, env, windowsHide: true });
        expect(loaded.stdout.trim()).toBe('function');
      }
      const args = ['image', 'generate', '--direct', '--prompt', 'ceramic cup', '--model', 'Nano Banana 2', '--no-wait'];
      const first = await run(...args);
      expect(first.idempotencyKey).toMatch(/^auto-/); expect(posts).toBe(1);
      const submissions = await run('tasks', 'list');
      expect(submissions[0].submitTimeoutMs).toBeGreaterThan(151000);
      const resumed = await run('tasks', 'resume', first.idempotencyKey, '--wait');
      expect(await readFile(resumed.paths[0], 'utf8')).toBe('downloaded-bytes');
      expect(JSON.parse(await readFile(first.recordPath, 'utf8'))).toMatchObject({ state: 'succeeded', result: { paths: resumed.paths } });
      expect((await run(...args)).taskId).toBe(first.taskId); expect(posts).toBe(1);
      await expect(run('image', 'generate', '--direct', '--prompt', 'changed', '--idempotency-key', first.idempotencyKey)).rejects.toMatchObject({ code: 4 });
      await expect(run('image', 'generate', '--direct', '--prompt', 'mixed', '--data', '{}')).rejects.toMatchObject({ code: 2 });
      expect(posts).toBe(1);
      await run(...args, '--allow-reroll'); expect(posts).toBe(2);
      await run('video', 'generate', '--direct', '--model', 'Wan3.0-Video', '--prompt', 'a cup', '--duration', '2', '--resolution', '480p', '--ratio', '16:9', '--no-audio', '--no-wait');
      expect(payloads[2]).toMatchObject({ model: 'Wan3.0-Video', duration: 2, audio: false, watermark: false, mode: 'text_to_video' });
      expect(payloads[0]).toMatchObject({ resolution: '4K', aspect_ratio: '1:1', n: 1 });
      malformed = true;
      await expect(run('doctor')).rejects.toMatchObject({ code: 5 });
    } finally { await new Promise<void>(done => server.close(() => done())); await rm(root, { recursive: true, force: true }); }
  }, 20000);
});
