import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
describe("initialization prompt", () => {
  it("prints the same Chinese prompt from the installer and the README", async () => {
    const prompt = (await readFile(resolve("docs/init-prompt.zh.txt"), "utf8")).trim();
    expect(prompt).toContain("这是新建项目后的新对话");
    expect(prompt).toContain("wowidea project init");
    expect(prompt).toContain("不需要加 --direct");
    const readme = await readFile(resolve("README.md"), "utf8");
    expect(readme).toContain("## 新建项目与对话时的初始化提示词");
    expect(readme).toContain("安装完成后，新建项目并开启新对话时，把下面这段交给 AI。");
    expect(readme).toContain(prompt);
    expect(await readFile(resolve("scripts/install.sh"), "utf8")).toContain("docs/init-prompt.zh.txt");
    expect(await readFile(resolve("scripts/install.ps1"), "utf8")).toContain("init-prompt.zh.txt");
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
