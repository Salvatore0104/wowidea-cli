import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initProject, readProject, requireProject, validateProject, recordCreation, referencePlan } from "../src/project.js";

describe("local programme workflow", () => {
  it("creates a portable blank project, never overwrites preferences or promotes experiments", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wowidea-project-"));
    try {
      const { path, project } = await initProject(dir, "超现实节目");
      const before = await readFile(path, "utf8");
      expect((await readProject(dir)).project).toEqual(project);
      await expect(initProject(dir)).rejects.toThrow(/never overwrites/);
      const draft = { schemaVersion: "wowidea.creation/v1", id: "intro-draft", prompt: "Fold the room inside out", model: "MiniMax-H3", mode: "text_to_video", settings: { duration: 8, aspectRatio: "16:9" }, references: [], taskId: null, outputs: [], qc: { verdict: "not_reviewed", evidence: [] } };
      const result = await recordCreation(dir, draft);
      expect(result.record.referenceCounts).toEqual({ images: 0, videos: 0, audio: 0 });
      expect(await readFile(path, "utf8")).toBe(before);
      await expect(recordCreation(dir, draft)).rejects.toThrow(/id exists/);
      await expect(recordCreation(dir, { ...draft, id: "../escape" })).rejects.toThrow(/safe unique/);
      await expect(recordCreation(dir, { ...draft, id: "qc", qc: { verdict: "pass", evidence: [] } })).rejects.toThrow(/observations/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("requires an initialized project before use and does not invent one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wowidea-require-"));
    try {
      await expect(requireProject(dir)).rejects.toThrow(/尚未初始化/);
      await initProject(dir, "已初始化");
      await expect(requireProject(dir)).resolves.toMatchObject({ project: { name: "已初始化" } });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("distinguishes stage pixels from generated output and requires evidence for accepted direction", async () => {
    expect(() => validateProject(null)).toThrow(/project/);
    const dir = await mkdtemp(join(tmpdir(), "wowidea-project-"));
    try {
      const { project } = await initProject(dir);
      project.stage.screens = [{ name: "main", width: 5760, height: 1080, safeArea: "bottom centre" }];
      expect(() => validateProject(project)).not.toThrow();
      project.preferences.approvedDirections.push({ description: "chrome storm", confirmation: "", confirmedAt: "2026-09-08" });
      expect(() => validateProject(project)).toThrow(/confirmation/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("keeps stable per-media order and role mapping for mixed references", () => {
    const ref = (type: "image" | "video" | "audio", role: string) => ({ type, role, source: `assets/${role}`, scope: role, preserve: ["silhouette"], change: ["material"] });
    const plan = referencePlan([ref("image", "hero"), ref("video", "motion"), ref("image", "texture"), ref("audio", "rhythm")]);
    expect(plan.references.map(r => r.label)).toEqual(["image1", "video1", "image2", "audio1"]);
    expect(plan.references.filter(r => r.type === "image").map(r => r.role)).toEqual(["hero", "texture"]);
    expect(plan.referenceCounts).toEqual({ images: 2, videos: 1, audio: 1 });
    expect(() => referencePlan([ref("image", "same"), ref("video", "same")])).toThrow(/unique/);
  });
});
