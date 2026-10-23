# Execute and recover

Use the project-local CLI when a runtime is installed, otherwise installed `wowidea`. Before image or video generation, the directory must contain `.wowidea/project.json` from `wowidea project init`. Generation uses the direct API by default. Direct options or a UTF-8 request file are sufficient. Generate/edit automatically saves a request key, waits and downloads; explicit `--idempotency-key` remains available. Local references upload through the website and use returned expiry/accessibility checks. Retain the running process until completion.

After interruption use `tasks resume <key> --wait --dir <outputs>`. With a known task ID use `image|video status <id>`, `watch <id>` or `download <id>`. These observe the same task. The website handles provider failover; CLI observation retries never create another generation. Without proof of task ownership the request stays uncertain; nearby tasks are not automatically adopted.

An unchanged request automatically reuses its key. A reused explicit key with changed input is a conflict. When the user requests another identical result, use `--allow-reroll` (and a fresh key if specifying one). Do not use reroll to bypass an uncertain submission.

Storyboards, manifests and price approvals are not prerequisites, including Seedance. Additional user constraints still apply. Keep video watermark:false. `--no-wait` returns acceptance only; later resume waits and downloads. A successful API response is not visual acceptance.

Show local output media, task state and available pricing. Do not infer a task's charge from account balance changes. Run records update on resume; originals remain unchanged during edits. Failed downloads can be repeated for the same task. Never regenerate merely to fix a download failure.
