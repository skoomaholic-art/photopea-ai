# Poster Editor 3.0 - Google Cloud Run release

This release includes PR #13 (PNG logo rename/delete) and PR #15 (header library, local poster archive, responsive AI buttons, cinematic pixel empty state).

Target is the **existing** Google Cloud Run service `poster-editor` in project `skoomaholic-poster-editor`, region `europe-west1`. No paid AI provider is enabled in the editor. The initial pipeline is deliberately triggered by this named commit and uses the existing Google Workload Identity Federation connection.

Further improvement work continues against this same repository and service. Hosting uses Cloud Run, Cloud Build, and Artifact Registry under the existing Google billing configuration and therefore cannot guarantee zero charges.

## Consolidated update

PR #16 integrated the complete browser-local ZIP library transfer, poster archive, official open-source Wikidata artwork search enrichment and the polished pixel-art empty states for all native canvases. Legacy paid AI generation remains disabled; a verified general-purpose no-cost local text-to-image model is not yet included. Existing Cloud Run deployment workflow is configured to publish the actual healthy URL as a comment on PR #16.
