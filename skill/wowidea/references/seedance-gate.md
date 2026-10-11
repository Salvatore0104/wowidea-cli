# Seedance storyboard tools are optional

Generation does not require an approved manifest. `wowidea video generate --task video` submits model `豆包Seedance-2.5` with `draft: true` and `resolution: 480p`. The display name stays Seedance 2.5 样片. Do not send model `Seedance-2.5-Draft`: that result is `stage: direct` and cannot be finalized. Keep `watermark: false`.

Seedance 2.5 成片 is not a second prompt. Run `wowidea video finalize <draftId>`, read the labeled estimate, then repeat with `--yes`. The final is 1080p. The CLI checks `videoGeneration.stage` is `draft`, reuses `existingTaskId`, and stores one idempotency UUID per draft. Batch jobs and fallback chains never submit a final render.

`seedance validate` and `seedance approve` remain available when a project wants a storyboard record. They do not block generation.
