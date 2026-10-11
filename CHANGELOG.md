# Changelog

## 0.8.0

- Any harness can drive the CLI. `wowidea capabilities --json` dumps the routing table, commands, and expected JSON. `WOWIDEA_API_KEY` is the primary key; `EASYAI_API_KEY` still works.
- Video defaults to Seedance-2.5-Draft (样片, `draft: true`, 480p or 720p). Storyboard approval is no longer a generation gate.
- Seedance-2.5-Final is `wowidea video finalize <draftId>`. The command shows a cost estimate and submits only with `--yes`. It checks the draft, stores the final task, and will not finalize the same draft twice. Batch and fallback chains never submit a final.
- `models by-task`, `--task` with a bounded fallback chain, `batch run`, `layers`, and `key` (chroma cutout via sharp).
- Routing data lives in `data/model-routing.json`.
