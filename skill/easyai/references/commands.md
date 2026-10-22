# Command routing

Use CLI help for exact arguments. `wowidea` uses API-key authentication for model discovery, pricing, and generation. Generation uses the direct API by default; do not pass `--direct`. Before image or video generation, initialize the directory with `wowidea project init --dir <dir> --name <name>`. Media execution, costs and recovery follow [the shared workflow](../../wowidea/references/workflow.md).

Seedance 2.5 drafts generate without an approval manifest. Final renders use `wowidea video finalize <draftId> --yes` and are never batched. Observation does not authorize cancellation. Large output supports --output. Start with `wowidea capabilities --json`. Exit codes: 2 usage, 3 auth, 4 conflict, 5 service/uncertain, 6 approval, 7 budget.
