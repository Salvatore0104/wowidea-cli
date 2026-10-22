import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

// Run via npm run package:smoke -- <archive>. No account access or generation.
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run through npm run package:smoke so the npm CLI path is known.');
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')).version;
const archive = resolve(process.argv[2] || `easyai-cli-${version}.tgz`);
const temp = await mkdtemp(join(tmpdir(), 'wowidea-package-smoke-'));
try {
  execFileSync(process.execPath, [npm, 'install', '--prefix', temp, archive, '--ignore-scripts', '--omit=optional', '--no-audit', '--no-fund'], { stdio: 'pipe' });
  const pkg = join(temp, 'node_modules/@easyai/cli');
  const work = join(temp, 'programme'); await mkdir(work);
  const run = (...args) => JSON.parse(execFileSync(process.execPath, [join(pkg, 'dist/cli.js'), '--json', ...args], { cwd: work, encoding: 'utf8' })).data;
  const setup = run('project', 'setup', '--dir', work);
  const standalone = (...args) => JSON.parse(execFileSync(process.execPath, [join(work, '.wowidea/runtime/dist/cli.js'), '--json', ...args], { cwd: work, encoding: 'utf8' })).data;
  for (const skill of ['easyai', 'gpt-image-25-prompt', 'wowidea']) await readFile(join(work, '.agents', 'skills', skill, 'SKILL.md'), 'utf8');
  assert.equal(standalone('guides', 'list').length, 23);
  assert.equal(setup.credentialRuntime.available, false); // optional deps intentionally omitted
  assert.equal(run('guides', 'list').length, 23);
  assert.equal(run('guides', 'show', 'minimax-h3').version, version);
  for (const id of ['design-tasks', 'production-rounds', 'recipe-authoring']) {
    const guide = run('guides', 'show', id);
    assert.equal(guide.content, await readFile(guide.path, 'utf8'));
    assert.equal(guide.version, version);
  }
  assert.equal(run('project', 'show').project.name, '');
  assert.equal(run('project', 'validate').valid, true);
  const path = join(work, '.wowidea/project.json'), before = await readFile(path, 'utf8');
  assert.equal(run('project', 'record', '--file', join(pkg, 'docs/examples/vj-programme/creation-draft.json')).record.taskId, null);
  const env = { ...process.env, WOWIDEA_SKILLS_DIR: join(temp, 'skills'), EASYAI_CONFIG_DIR: join(temp, 'config') };
  const install = () => JSON.parse(execFileSync(process.execPath, [join(pkg, 'scripts/install-skills.mjs')], { env, cwd: work, encoding: 'utf8' }));
  const installed = install();
    assert.equal(installed.version, version);
  assert.deepEqual(installed.installedSkills, ['easyai', 'gpt-image-25-prompt', 'wowidea']);
  // Every model guide is an internal Wowidea reference reached through the single
  // $wowidea entry, so each one must resolve inside both the package and the install.
  for (const id of ['minimax-h3', 'seedance-20', 'seedance-25', 'gpt-image', 'gpt-image-25', 'nano-banana', 'midjourney']) {
    const guide = run('guides', 'show', id);
    assert.equal(guide.promptSkill, id === 'gpt-image-25' ? 'gpt-image-25-prompt' : undefined);
    assert.ok(guide.path.startsWith(pkg));
    assert.ok((await readFile(join(pkg, 'skill', 'wowidea', guide.guide), 'utf8')).length > 30);
    assert.equal(await readFile(join(temp, 'skills', 'wowidea', guide.guide), 'utf8'), guide.content);
  }
  const skill = join(temp, 'skills/wowidea/SKILL.md'); await writeFile(skill, 'custom programme skill');
  assert.equal(install().preserved.length, 1);
  assert.equal(await readFile(skill, 'utf8'), 'custom programme skill');
  assert.equal(await readFile(path, 'utf8'), before);
  execFileSync(process.execPath, [join(pkg, 'scripts/check-resources.mjs')], { cwd: work, stdio: 'pipe' });
  console.log(JSON.stringify({ valid: true, archive, guides: 23, installedSkills: 3, separateInstallation: true, differentCwd: true, projectRoundTrip: true, customSkillPreserved: true, credentialsTested: false, paidCalls: 0 }));
} finally {
  const rel = relative(resolve(tmpdir()), resolve(temp));
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || !basename(temp).startsWith('wowidea-package-smoke-')) throw new Error('Unexpected cleanup target');
  await rm(temp, { recursive: true, force: true });
}
