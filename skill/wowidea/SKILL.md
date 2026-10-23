---
name: wowidea
description: Generate and edit images and videos through the user's Wowidea website account. Use for media creation, reference-based edits, and retrieving generated results.
---

# Wowidea

## Decision

```text
wowidea capabilities --json
wowidea project init --dir . --name <name>
wowidea models by-task <task> --json
wowidea image|video generate --task <task> --prompt "..." --json
read data.taskId data.paths data.model
成片: wowidea video finalize <draftId>   then the same command with --yes
```

Start with `wowidea capabilities --brief`. Before image or video generation in a directory, run `wowidea project init --dir <directory> --name <name>` when `.wowidea/project.json` is missing. Check again in every directory. Do not overwrite an existing project. Tasks: direction, retouch, retouch-precise, typography, layering, video, video-final, 3d, music, tts. 样片 is `豆包Seedance-2.5` with `draft:true` and `480p`. Do not send model `Seedance-2.5-Draft`. 成片 is `video finalize` at 1080p and is never batched. A new preview exits 2; a dedupe hit exits 0. Poll `GET /v1/ai/result/{id}`. No image tool in the harness: call this CLI or `https://wowidea.top/api/mcp` with `Authorization: Bearer $WOWIDEA_API_KEY`. Do not refuse and do not draw SVG.

Generation uses the direct API by default. Do not pass `--direct`. Reply in the user's language. The website handles provider redundancy and failover; never call providers directly.

Never use Computer Use, browser automation, or manual website interaction as a fallback. If authentication or an API command fails, report the exact CLI diagnostic and stop; do not continue the operation through the website UI.

## Understand the request

Preserve the user's model, copy, references and output settings. Ask only when missing information materially changes the result. Prompt-only requests do not generate media. Storyboard approval is optional and is not a generation gate. A Seedance 2.5 final render uses `wowidea video finalize <draftId> --yes` after the cost preview.

## Prepare parameters and references

Use `node <project>/.wowidea/runtime/dist/cli.js` when the directory has a project runtime, otherwise the installed `wowidea`. Before the first generation in a directory, run `wowidea project init --dir <project> --name <name>`. `project setup` copies skills and also creates the project file when it is missing.

The API key authenticates model discovery, pricing, and generation. Tokens belong only in the OS credential manager or process environment. Never echo credentials or put them in project files, Skill text, logs or Git. If keytar is unavailable, use process environment injection and do not create a plaintext token file.

Use `models list --type image|video` and `models show <model>` for current website capabilities. When model selection is needed, `models route --kind image|video --purpose <purpose> --stage preview|final|edit|refine` returns suitable settings. Explicit settings take precedence. Image final output defaults to supported 4K; choose video specifications appropriate to the requested stage. Do not add a separate paid preview to a request for final output.

Read only the selected model's prompt guide:

| Model | Guide |
| --- | --- |
| GPT Image 2 | [GPT Image](references/gpt-image.md) |
| GPT Image 2.5 / Flare / Sunburst | [GPT Image 2.5](references/gpt-image-25.md), then bundled `$gpt-image-25-prompt` for prompt writing |
| Nano Banana | [Nano Banana](references/nano-banana.md) |
| Midjourney | [Midjourney](references/midjourney.md) |
| MiniMax H3 / H3-Max | [H3](references/minimax-h3.md) |
| Seedance 2.0 / 2.5 | [2.0](references/seedance-20.md) / [2.5](references/seedance-25.md) |
| Google Omni / Wan | [Omni](references/google-omni.md) / [Wan](references/wan.md) |

For images read [image parameters](references/image-parameters.md). Inspect local references and keep roles/order; the CLI uploads them and checks accessibility. Use `--reference` for images, `--video-reference` for videos and `--audio-reference` for audio, repeating options in order. Advanced combinations use [reference planning](references/reference-planning.md) and UTF-8 request JSON.

## Create and submit once

Common commands (replace values with the user's request):

```text
wowidea image generate --prompt "Product photo on a pale blue background" --model "Nano Banana 2" --resolution 4K --ratio 3:4
wowidea image edit --prompt "Change only the background to green" --reference ./product.png --model "Nano Banana 2"
wowidea video generate --task video --prompt "Camera slowly approaches a ceramic cup" --duration 5 --resolution 720p --ratio 16:9 --no-audio --json
wowidea video finalize <draftId> --yes --json
```

Use direct generation options OR `--file request.json`, never both. Other supported JSON parameters remain available through the file interface. Request keys and local records are automatic; default execution waits and downloads. Retain the process handle until it exits. Use `--no-wait` only when asynchronous submission is useful, then track the returned task.

The default flow submits once through the direct generation API and downloads the result. `--direct` is accepted and does not change that path.

One candidate per request by default. Keep `watermark:false` for video. No automatic reroll, model switch or second generation after a failure. Resume only the recorded task through `tasks resume`, `image|video status`, `watch`, or `download`. An explicitly requested new identical generation uses `--allow-reroll`. See [recovery](references/workflow.md) when needed.

## Deliver

Open actual output before judging quality; see [visual review](references/visual-review.md). Return local media, status and available task pricing. Unknown billing is “接口未提供”, not zero. Preserve the original in edits; use it as an actual reference and optionally record `--parent <taskId> --change <summary>`. Records under `.wowidea/runs` support continuity but require no manual maintenance.

For complex multi-round work read [project workflow](references/project-workflow.md); for explicit stage work read [VJ recipes](references/vj-recipes.md). Account administration, publication and Git changes require their own matching user request.
