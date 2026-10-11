import { readFile, writeFile, mkdir, readdir, copyFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const codexRoot = process.env.CODEX_HOME || join(homedir(), '.codex');
const destination = process.env.WOWIDEA_SKILLS_DIR || join(codexRoot, 'skills');
const stateDir = process.env.EASYAI_CONFIG_DIR || join(homedir(), '.config', 'easyai');
await mkdir(stateDir, { recursive: true });
const statePath = join(stateDir, 'wowidea-install.json');
const previous = await readFile(statePath, 'utf8').then(JSON.parse).catch(() => ({ hashes: {} }));
const hashes = { ...previous.hashes }; const preserved = [];
const digest = b => createHash('sha256').update(b).digest('hex');
async function sync(source, target) {
  await mkdir(target, { recursive: true });
  for (const item of await readdir(source, { withFileTypes: true })) {
    const from = join(source, item.name), to = join(target, item.name);
    if (item.isDirectory()) { await sync(from, to); continue; }
    const incoming = await readFile(from), current = await readFile(to).catch(() => null);
    const knownLegacy = item.name === 'SKILL.md' && target.endsWith('easyai') && digest(current || '') === '815116c8e239871694906fbf07c9e4c4f459a749f2376c6f18dbe943c323f37c';
    if (current && !knownLegacy && digest(current) !== digest(incoming) && digest(current) !== previous.hashes?.[to]) {
      const update = join(stateDir, 'skill-updates', to.replace(/[^a-zA-Z0-9._-]/g, '_'));
      await mkdir(dirname(update), { recursive: true }); await copyFile(from, update); preserved.push({ path: to, update }); continue;
    }
    await copyFile(from, to); hashes[to] = digest(incoming);
  }
}
const installedSkills = [];
for (const entry of await readdir(join(root, 'skill'), { withFileTypes: true })) {
  if (!entry.isDirectory() || !await readFile(join(root, 'skill', entry.name, 'SKILL.md')).then(() => true).catch(() => false)) continue;
  await sync(join(root, 'skill', entry.name), join(destination, entry.name));
  installedSkills.push(entry.name);
}
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
await writeFile(statePath, JSON.stringify({ ...previous, version: pkg.version, installedAt: new Date().toISOString(), defaults: previous.defaults || { image: 'Nano Banana 2', video: 'Seedance-2.5-Draft' }, destination, installedSkills, hashes, preserved }, null, 2));
console.log(JSON.stringify({ installed: destination, version: pkg.version, installedSkills, preserved, message: 'Wowidea Skill 已安装。任何助手先读 SKILL.md，再运行 wowidea capabilities --json。更新保留了用户修改，待合并版本在配置目录 skill-updates。' }));
