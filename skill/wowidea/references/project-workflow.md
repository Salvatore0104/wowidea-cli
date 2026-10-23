# Project preferences and records

Required before image or video generation, batch runs, and generated layers. Check every directory before use. One-off images still need `project init`; they do not need stage settings. Use the user's directory, not an inferred neighbouring project. Commands run offline:

```text
wowidea --json project init --dir <directory> --name <name>
wowidea --json project show --dir <directory>
wowidea --json project validate --dir <directory>
wowidea --json project record --dir <directory> --file <creation.json>
```

init creates .wowidea/project.json and refuses overwrite. Schema wowidea.project/v1 contains name, theme, audience, stage and preferences. Non-stage projects leave stage.screens empty and other stage strings blank. Put per-creation generation/delivery settings in settings; do not invent LED specifications.

preferences contains styles, preserve, avoid and approvedDirections. Each accepted direction needs description, actual user confirmation and confirmedAt. Experiments remain per-creation, without cross-project promotion.

Use immutable draft/submitted/result IDs in .wowidea/creations. Schema wowidea.creation/v1 requires id, prompt, exact model, mode, settings, references, taskId (null for drafts), outputs and qc. Each reference needs type, unique role, source, scope, preserve and change. Relative paths resolve from the project directory. Revisions use new IDs.

Save taskId promptly. Failed recording is a local repair, not a new generation. qc.verdict is not_reviewed, pass or revise; reviewed verdicts require outputs, reviewedAt and concrete evidence. Never invent task IDs or observations.

Private signed URLs, manifests and executable requests belong in .wowidea/private with a project ignore rule. Shared records use stable source paths; credentials never enter them. Updates preserve user files.
