import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
describe("chat prompts", () => {
  it("keeps three short Chinese prompts and points installers at the right file", async () => {
    await expect(readFile(resolve("docs/init-prompt.zh.txt"), "utf8")).rejects.toThrow();
    const first = (await readFile(resolve("docs/prompts/首次安装.txt"), "utf8")).trim();
    const update = (await readFile(resolve("docs/prompts/更新.txt"), "utf8")).trim();
    const deploy = (await readFile(resolve("docs/prompts/部署.txt"), "utf8")).trim();
    expect(first).toContain("wowidea project init");
    expect(first).toContain("不要加 --direct");
    expect(first).toContain("不要用画布");
    expect(update).toContain("刚升级");
    expect(update).toContain("不要覆盖已有项目");
    expect(deploy).toContain("上线");
    expect(deploy).toContain("WOWIDEA_API_KEY");
    const readme = await readFile(resolve("README.md"), "utf8");
    expect(readme).toContain("docs/prompts/首次安装.txt");
    expect(readme).toContain("docs/prompts/更新.txt");
    expect(readme).toContain("docs/prompts/部署.txt");
    expect(readme).not.toContain("docs/init-prompt.zh.txt");
    expect(readme).not.toContain("这是新建项目后的新对话");
    const sh = await readFile(resolve("scripts/install.sh"), "utf8");
    const ps1 = await readFile(resolve("scripts/install.ps1"), "utf8");
    expect(sh).toContain("docs/prompts/首次安装.txt");
    expect(sh).toContain("docs/prompts/更新.txt");
    expect(sh).toContain('MODE="update"');
    expect(ps1).toContain("docs\\prompts\\");
    expect(ps1).toContain("首次安装.txt");
    expect(ps1).toContain("更新.txt");
    expect(ps1).toContain("InstallMode = 'update'");
    expect(sh).not.toContain("init-prompt.zh.txt");
    expect(ps1).not.toContain("init-prompt.zh.txt");
    expect(await readFile(resolve("scripts/install-macos.sh"), "utf8")).toContain("docs/prompts/首次安装.txt");
    expect(await readFile(resolve("scripts/install-windows.ps1"), "utf8")).toContain("首次安装.txt");
  });

  it("points the key prompt at a step-by-step environment variable guide", async () => {
    const guide = await readFile(resolve("docs/创建环境变量.md"), "utf8");
    expect(guide).toContain("https://wowidea.top/user/api-key");
    expect(guide).toContain("~/.zshrc");
    expect(guide).toContain("~/.bashrc");
    expect(guide).toContain("sysdm.cpl");
    expect(guide).toContain("用户变量");
    expect(guide).toContain("setx WOWIDEA_API_KEY");
    expect(guide).toContain("echo \"$WOWIDEA_API_KEY\"");
    expect(guide).toContain("wowidea balance");
    expect(guide).toContain("不要把密钥贴进聊天");
    const readme = await readFile(resolve("README.md"), "utf8");
    expect(readme).toContain("docs/创建环境变量.md");
    const sh = await readFile(resolve("scripts/install.sh"), "utf8");
    const ps1 = await readFile(resolve("scripts/install.ps1"), "utf8");
    expect(sh).toContain("docs/创建环境变量.md");
    expect(sh).toContain("已检测到 WOWIDEA_API_KEY，跳过输入。");
    expect(sh).toContain("read -r -s");
    expect(sh).toContain("with hidden answer");
    expect(ps1).toContain("docs/创建环境变量.md");
    expect(ps1).toContain("已检测到 WOWIDEA_API_KEY，跳过输入。");
    expect(ps1).toContain("UseSystemPasswordChar");
    expect(ps1).not.toContain("请在命令前加上");
  });
});
describe("bundled Skill installer", () => {
  it("installs self-contained guides, preserves customizations and leaves account config alone", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wowidea-install-test-"));
    const env = { ...process.env, EASYAI_CONFIG_DIR: join(dir, "config"), WOWIDEA_SKILLS_DIR: join(dir, "skills") };
    const run = () => JSON.parse(execFileSync(process.execPath, [resolve("scripts/install-skills.mjs")], { env, encoding: "utf8" }));
    try {
      const first = run();
      expect(first.version).toBe(version);
      expect(first.installedSkills).toEqual(["easyai", "gpt-image-25-prompt", "wowidea"]);
      for (const name of first.installedSkills) {
        expect(await readFile(join(dir, "skills", name, "SKILL.md"), "utf8")).toBe(await readFile(resolve("skill", name, "SKILL.md"), "utf8"));
      }
      expect(await readFile(join(dir, "skills", "wowidea", "SKILL.md"), "utf8")).toContain("Never use Computer Use");
      expect(await readFile(join(dir, "skills", "wowidea", "SKILL.md"), "utf8")).toContain("direct API");
      const config = join(dir, "config", "config.json"), skill = join(dir, "skills", "wowidea", "SKILL.md");
      await writeFile(config, '{"profiles":{"private":"keep unchanged"}}');
      const before = await readFile(config, "utf8");
      await writeFile(skill, "user custom instructions");
      const result = run();
      expect(result.preserved).toEqual([expect.objectContaining({ path: skill })]);
      expect(await readFile(skill, "utf8")).toBe("user custom instructions");
      expect(await readFile(config, "utf8")).toBe(before);
      expect(await readFile(join(dir, "skills", "wowidea", "references", "seedance-25.md"), "utf8")).toContain("2.5");
      const resources = JSON.parse(await readFile(join(dir, "skills", "wowidea", "resources.json"), "utf8"));
      for (const path of Object.keys(resources.files)) expect((await readFile(join(dir, "skills", path))).length).toBeGreaterThan(0);
      expect(await readFile(join(dir, "skills", "wowidea", "references", "upstream-lock.json"), "utf8")).toBe(await readFile(resolve("skill/wowidea/references/upstream-lock.json"), "utf8"));
      expect(await readFile(result.preserved[0].update, "utf8")).toContain("name: wowidea");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
