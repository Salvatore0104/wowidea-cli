# Seedance storyboard tools are optional

Generation does not require an approved manifest. `wowidea video generate --task video` submits Seedance-2.5-Draft (样片) with `draft: true`. Keep `watermark: false`.

Seedance-2.5-Final (成片) is not a second prompt. Run `wowidea video finalize <draftId>`, read the cost, then repeat with `--yes`. The CLI checks that the draft succeeded, refuses a non-draft model, and will not finalize the same draft twice. Batch jobs and fallback chains never submit a final render.

`seedance validate` and `seedance approve` remain available when a project wants a storyboard record. They do not block generation.
