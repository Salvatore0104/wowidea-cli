# Changelog

## Unreleased

- Docs: README opens with a chat prompt so a coding agent can install the CLI. `docs/agent-install.md` is the non-interactive runbook (env `WOWIDEA_API_KEY`, no TTY, no sudo). Linked from AGENTS.md and llms.txt.
- Install: `scripts/install.sh` and `scripts/install.ps1` are idempotent one-line installers. They clone or update `~/.wowidea-cli`, build, `npm link` (or pack into `~/.local` when the global prefix is not writable), store `WOWIDEA_API_KEY` via `wowidea auth use-key` when the keychain works, otherwise shell startup files or `setx`, then run `wowidea balance`. A failed balance check does not fail the install. README, docs/install.md, and AGENTS.md lead with the curl and PowerShell commands.
- Docs: rewrite README and docs/install.md around the 0.8.0 command contract (install, API key, harness setup, routing, JSON, exit codes 0–7). `npm install -g github:Salvatore0104/wowidea-cli` is not a supported install path.

## 0.8.0

- A finalizable Seedance 2.5 draft is `豆包Seedance-2.5` with `draft: true` and `480p`. The `Seedance-2.5-Draft` id is only a display alias.
- `video finalize` checks `/v1/video/results/{resultId}/finalization`, submits 1080p, and shows an estimate based on the 1080p direct price (149.68 / 4s). That estimate is not a live finalize quote.
- Generation sends `x-async: true` and polls `GET /v1/ai/result/{id}`. A tasks payload that says "is processing" stays in progress.
- Chroma key samples the real border color. Auto mode uses CbCr distance and hue, so dark yellow and dark green stay opaque.
- Generation JSON includes `data.taskId` and `data.model` (`alias`, `upstream`, `request`). `models by-task video` returns `豆包Seedance-2.5` with `draft: true` and `480p`.
- `models list` prints ids by type. `--json` is `{id, alias, types, upstream}` unless `--raw`. `balance --json` is `data.total` plus `data.raw`.
- `capabilities --brief` is the short card. A finalize dedupe preview exits 0; `--yes` on a duplicate downloads the existing file.

- Any harness can drive the CLI. `wowidea capabilities --json` dumps the routing table, commands, and expected JSON. `WOWIDEA_API_KEY` is the primary key; `EASYAI_API_KEY` still works.
- Storyboard approval is no longer a generation gate. A final still requires `wowidea video finalize <draftId> --yes`, and batch or fallback never submits one.
- `models by-task`, `--task` with a bounded fallback chain, `batch run`, `layers`, and `key` (chroma cutout via sharp).
- Routing data lives in `data/model-routing.json`.
