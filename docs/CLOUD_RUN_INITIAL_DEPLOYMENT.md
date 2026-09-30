# Initial Google Cloud Run deployment

The production Dockerfile and a one-time initial deployment trigger landed on main in PR #11 (commit `5c46dbd71effa83ddccf508aaf046fb1f1777f56`). The target is Google Cloud project `skoomaholic-poster-editor`, region `europe-west1`, service `poster-editor`. The production service URL and readiness must be verified in the Google Cloud console or in GitHub Actions logs; do not infer deployment success from the merge alone.

Deployment settings limit the service to min instances 0 and max instances 1 and disable paid AI requests. These are risk-reducing limits rather than a guarantee of zero cloud charges. GitHub Pages remains the fallback and no local browser storage is automatically transferred between origins.

A separate read-only verification workflow may post the status to PR #11. Subsequent deployments remain manually gated by `GCP_DEPLOY_ENABLED`.
