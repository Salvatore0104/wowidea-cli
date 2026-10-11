# Automatic model selection

Explicit requirements > capability > task fit > sourced cost and latency. Ask purpose and preview/final stage only when unclear. Default one output. Call models route with --purpose, --stage and a JSON constraints file; preserve --model and all explicit settings. Route results explain exclusions and proposed settings. If needsInput is true, ask the supplied question before submitting.

Images: Midjourney for style/composition exploration; Nano Banana 2 for general creation and reference edits; GPT Image 2.5 for exact typography/layout/complex constraints; Nano Banana Pro for detail refinement when suitable. These are alternatives, not mandatory serial steps. Prefer 4K where supported, especially final. A lower resolution is not a saving without a price difference. If final 4K is unavailable, state the supported output and resolve the delivery requirement, never call resized media native 4K.

Video preview defaults to the Seedance 2.5 样片 contract: model `豆包Seedance-2.5`, `draft: true`, 480p. Fallbacks are Seedance 2.0 fast, Seedance 2.0, Seedance 2.0 mini, Wan 3.0, MiniMax H3, then Google Omni. Query live capabilities and never infer prices from names. A final render is `wowidea video finalize <draftId> --yes` from the draft result id, never a regenerated prompt and never an automatic reroll. Preserve explicit duration; suggest 5 seconds for an unspecified single shot.

Use prices import <snapshot.json> for sourced website pricing; prices show reports availability. Unknown estimates never block generation or justify claims of cheapest pricing. User feedback authorizes the corresponding edit without another points confirmation. Keep references, parent task and change summary in run records. Inspect actual outputs before QC claims.
