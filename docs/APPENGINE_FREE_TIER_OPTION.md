# Google Cloud App Engine Standard option for Poster Editor

This is an alternative to the unmerged Cloud Run PR. The existing GitHub Pages
site and Cloudflare Worker stay untouched. Neither App Engine nor its build
pipeline has been deployed by this PR.

## What this changes

- App Engine **Standard**, Node.js 24, the existing Node HTTP server and
  same-origin API. It uses the existing `index.html`, editor scripts, TOP10,
  Photopea and local browser-based tools.
- A Google build step generates the existing vendor scripts and assets.
- F1 with `max_instances: 1` and `min_instances: 0` minimizes instance-hour usage.
- Billable AI and remote background-removal calls stay disabled.
- Manual GitHub workflow is **off** unless
  `GCP_APPENGINE_DEPLOY_ENABLED=true` is explicitly set.

## Billing: not a zero-spend guarantee

Google's App Engine **Standard** free quota is 28 F1 instance-hours **per day**
and 1 GiB outbound traffic **per day**. A single F1 instance generally fits
the instance-hour quota, but overage remains possible (especially egress).
Cloud Build and Artifact Registry may cost money independently. Cloud Run's
spend cap does **not** cap App Engine. Standard Google Cloud budgets send
alerts, not a hard block. Do not deploy while the owner's condition remains
"absolutely no possible charges".

Pricing and limits:
https://cloud.google.com/appengine/pricing
https://docs.cloud.google.com/appengine/docs/standard/quotas
https://docs.cloud.google.com/appengine/docs/standard/managing-costs

## Remaining steps, only after owner explicitly accepts residual cost risk

1. Have the owner select the app's **irreversible region**. For
   previously chosen Cloud Run `europe-west1`, App Engine's corresponding
   region name is `europe-west`.
2. With the owner's approval, create App Engine app by
   `gcloud app create --region=europe-west --project=skoomaholic-poster-editor`.
3. Authorize only the dedicated GitHub deploy identity to deploy versions.
   Official roles: `roles/appengine.deployer`,
   `roles/cloudbuild.builds.editor`,
   `roles/storage.objectAdmin`, plus
   `roles/iam.serviceAccountUser` on the selected App Engine runtime account.
4. Add budget alerts for the **entire dedicated project**, rather than only
   Cloud Run. Monitor App Engine egress and Artifact Registry storage.
5. Merge this PR and manually enable the
   `GCP_APPENGINE_DEPLOY_ENABLED` repository variable only after approval.
   Never create a broad deploy token or commit a private service-account key.
6. Check editor functionality and exports at the actual new App Engine URL.
   The previous website stays as fallback.

## Browser data warning

IndexedDB files, logo archive, PSD and autosaves on
`skoomaholic-art.github.io` **will not follow** a new origin automatically.
An archive export/import migration must be provided or the old website retained.
Do not clear old-site browser data.

## Build requirements

`package.json`'s `gcp-build` generates Fabric/PSD browser dependencies at
build time (when devDependencies exist); the Google buildpack prunes them before
runtime. The Node server serves browser files from the source root, not from
App Engine static handlers or an unrelated copied `dist` folder.
