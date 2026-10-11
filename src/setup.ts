import { readFile, writeFile, mkdir, readdir, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { initProject } from './project.js';
import { CliError, ExitCode } from './errors.js';
import { ensureCanvasBinding } from './canvas-binding.js';

const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const exists = (path: string) => access(path).then(() => true, () => false);
export async function setupProject(directory: string, update = false, packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..'), name?: string, profile?: string, createCanvas = false) {
  if (Number(process.versions.node.split('.')[0]) < 20) throw new CliError('Node.js 20+ is required.', ExitCode.Usage);
  const root = resolve(directory), statePath = join(root, '.wowidea', 'install.json');
  const previous = await readFile(statePath, 'utf8').then(JSON.parse).catch(() => null);
  const pkg = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  const hashes: Record<string,string> = { ...previous?.hashes }, preserved: string[] = [];
  let credentialRuntime = previous?.credentialRuntime || { platform: process.platform, arch: process.arch, available: false };
  await mkdir(root, { recursive: true });
  if (!previous || update) {
    const copy = async (source: string, relative: string): Promise<void> => {
      await mkdir(join(root, relative), { recursive: true });
      for (const e of await readdir(source, { withFileTypes: true })) {
        if (e.isSymbolicLink()) throw new CliError('Package symlinks are not supported.', ExitCode.Usage);
        const rel = relative + '/' + e.name, from = join(source, e.name), to = join(root, rel);
        if (e.isDirectory()) { await copy(from, rel); continue; }
        const incoming = await readFile(from), current = await readFile(to).catch(() => null);
        if (current && hash(current) !== hash(incoming) && hash(current) !== previous?.hashes?.[rel]) { preserved.push(rel); continue; }
        await writeFile(to, incoming); hashes[rel] = hash(incoming);
      }
    };
    await copy(join(packageRoot, 'dist'), '.wowidea/runtime/dist');
    await copy(join(packageRoot, 'skill'), '.wowidea/runtime/skill');
    if (await exists(join(packageRoot, 'data'))) await copy(join(packageRoot, 'data'), '.wowidea/runtime/data');
    await copy(join(packageRoot, 'skill', 'wowidea'), '.agents/skills/wowidea');
    await copy(join(packageRoot, 'skill', 'easyai'), '.agents/skills/easyai');
    await copy(join(packageRoot, 'skill', 'gpt-image-25-prompt'), '.agents/skills/gpt-image-25-prompt');
    await copy(join(packageRoot, 'skill', 'canvas-agent-operator'), '.agents/skills/canvas-agent-operator');
    // Native bindings are not included by the JS bundler. Carry the installed
    // platform's runtime files so a project outside this checkout can use them.
    credentialRuntime = { platform: process.platform, arch: process.arch, available: false };
    let keytarRoot: string | undefined;
    try {
      const require = createRequire(join(packageRoot, 'package.json'));
      require('keytar'); // Load the native binding without accessing stored credentials.
      keytarRoot = dirname(require.resolve('keytar/package.json'));
    } catch { /* env/stdin auth remains available */ }
    if (keytarRoot && await exists(join(keytarRoot, 'build/Release/keytar.node'))) {
      await copy(join(keytarRoot, 'lib'), '.wowidea/runtime/node_modules/keytar/lib');
      await copy(join(keytarRoot, 'build/Release'), '.wowidea/runtime/node_modules/keytar/build/Release');
      for (const name of ['package.json', 'LICENSE']) if (await exists(join(keytarRoot, name))) await writeFile(join(root, '.wowidea/runtime/node_modules/keytar', name), await readFile(join(keytarRoot, name)));
      credentialRuntime.available = true;
    }
    const require = createRequire(join(packageRoot, 'package.json'));
    const copyPackage = async (name: string) => {
      const from = dirname(require.resolve(`${name}/package.json`));
      await copy(from, join('.wowidea/runtime/node_modules', name));
    };
    await copyPackage('sharp');
    for (const name of ['detect-libc', 'semver', '@img/colour']) {
      try { await copyPackage(name); } catch { /* sharp still loads when the platform binary is present */ }
    }
    const imageRoot = join(dirname(require.resolve('sharp/package.json')), '..', '@img');
    for (const entry of await readdir(imageRoot, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory() || !entry.name.startsWith('sharp-')) continue;
      await copy(join(imageRoot, entry.name), join('.wowidea/runtime/node_modules/@img', entry.name));
    }
    const runtimePackage = join(root, '.wowidea/runtime/package.json');
    await writeFile(runtimePackage, JSON.stringify({ name: pkg.name, version: pkg.version, type: 'module', credentialRuntime }, null, 2));
  }
  if (!await exists(join(root, '.wowidea/project.json'))) await initProject(root, name || '');
  const instructionName = await exists(join(root, 'AGENTS.override.md')) ? 'AGENTS.override.md' : 'AGENTS.md';
  const instructions = join(root, instructionName), old = await readFile(instructions, 'utf8').catch(() => '');
  const begin = '<!-- wowidea:begin -->', end = '<!-- wowidea:end -->';
  const block = `${begin}\n## Wowidea media workflow\nRead .agents/skills/wowidea/SKILL.md, then wowidea capabilities --json. Pick a task, run the printed command, and read data.taskId, data.paths, and data.model. Use node .wowidea/runtime/dist/cli.js for creation and node .wowidea/runtime/dist/canvas-cli.js for full Canvas control. Creation defaults to the bound infinite Canvas; --direct is an explicit compatibility mode. Control Canvas only through the CLI and its HTTP/WebSocket APIs. Never use Computer Use, browser automation, or manual website interaction as a fallback; report and repair CLI authentication or API failures instead. If this harness cannot draw images, call the CLI or https://wowidea.top/api/mcp. Do not refuse and do not draw SVG. Video 样片 is 豆包Seedance-2.5 with draft true and 480p. A final render is only wowidea video finalize <draftId> --yes after the labeled estimate. Never batch or auto-fallback a final. Preserve the user's model and settings, keep outputs on Canvas and download them, and never automatically reroll. Keep credentials outside project files. No Git publication or website administration is implied.\n${end}`;
  if (old.includes(begin) !== old.includes(end)) throw new CliError('Incomplete Wowidea instruction markers; preserve and repair the existing file first.', ExitCode.Conflict);
  const next = old.includes(begin) ? old.slice(0, old.indexOf(begin)) + block + old.slice(old.indexOf(end) + end.length) : old + (old.endsWith('\n') || !old ? '' : '\n') + '\n' + block + '\n';
  await writeFile(instructions, next);
  const version = previous && !update ? previous.version : pkg.version;
  await writeFile(statePath, JSON.stringify({ version, hashes, preserved, credentialRuntime, installedAt: previous?.installedAt || new Date().toISOString(), updatedAt: new Date().toISOString() }, null, 2));
  const canvasBinding = createCanvas ? await ensureCanvasBinding(root, name, profile) : undefined;
  return { root, version, instructions, skill: join(root, '.agents/skills/wowidea/SKILL.md'), compatibilitySkill: join(root, '.agents/skills/easyai/SKILL.md'), promptSkill: join(root, '.agents/skills/gpt-image-25-prompt/SKILL.md'), canvasSkill: join(root, '.agents/skills/canvas-agent-operator/SKILL.md'), command: `node "${join(root, '.wowidea/runtime/dist/cli.js')}"`, canvasCommand: `node "${join(root, '.wowidea/runtime/dist/canvas-cli.js')}"`, canvasBinding, credentialRuntime, preserved, next: 'Read the project instructions now. Use Canvas OAuth for default creation and the API key only for models, pricing, and explicit --direct. Re-run setup --update after moving to another OS/architecture.' };
}
