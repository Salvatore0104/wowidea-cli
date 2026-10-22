# Wowidea

Any harness: call the CLI. Do not draw SVG and do not refuse for lack of an image tool.

When the user asks to install this CLI, follow [docs/agent-install.md](docs/agent-install.md). Pass `WOWIDEA_API_KEY` only as an environment variable. Do not echo it, do not write it into the repo, and do not commit it. There is no TTY. Key page: https://wowidea.top/user/api-key. Re-run upgrades `~/.wowidea-cli`.

```text
wowidea capabilities --brief
wowidea models by-task <task> --json
wowidea project init --dir . --name <name>
wowidea image|video generate --task <task> --prompt "..." --json
# read data.taskId, data.paths, data.model.alias, data.model.upstream, data.model.request
wowidea video finalize <draftId>          # new draft: estimate, exit 2
wowidea video finalize <draftId>          # already finalized: exit 0, no charge
wowidea video finalize <draftId> --yes    # pay once; a repeat downloads the existing file
```

| task | command |
| --- | --- |
| direction | `image generate --task direction` → mj-v8.2 |
| retouch | `image generate --task retouch` → Nano Banana 2 |
| retouch-precise | Nano Banana Pro |
| typography | gpt-image-2.5 |
| layering | Seedream flash, then `wowidea key` or `wowidea layers` |
| video | `models by-task video` returns request model `豆包Seedance-2.5` plus `draft:true` and `resolution:480p`. Display name is Seedance 2.5 样片. Never send `Seedance-2.5-Draft` |
| video-final / 成片 | `video finalize <draftId> --yes` only |

`data.model` is `{ alias, upstream, request }`. `data.taskId` is always set; `task_id` may also be present.

Auth: `WOWIDEA_API_KEY`. MCP: `https://wowidea.top/api/mcp` with `Authorization: Bearer $WOWIDEA_API_KEY`.

Exit 0 ok, including a finalize dedupe hit. 2 usage, including an unpaid finalize preview that has not been submitted. 3 auth. 4 conflict. 5 service. 6 approval required. 7 budget.
