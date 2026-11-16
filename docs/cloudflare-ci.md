# CI/CD: Cloudflare Workers Builds

GitHub is used for source control and pull requests. Tests, builds, previews, D1 migrations, and Worker deployments run in Cloudflare Workers Builds without GitHub Actions runners.

- Worker: `traumwohnung-housing-runtime`
- Production: `main` -> root tests, Worker syntax/tests, D1 schema migration and verification, Wrangler deploy.
- Pull requests: Cloudflare preview build runs root and Worker tests, then isolated preview deployment.
- Watched changes: `cloudflare/housing-runtime/**`, `tests/**`, `scripts/**`, root package files, and relevant Supabase runtime/migration files.
- The Cloudflare GitHub integration still publishes check runs in GitHub. Those check runs **do not** execute GitHub Actions.

The old `.github/workflows/` jobs were removed to stop Actions runner usage. Do not reintroduce GitHub-hosted CI; add necessary checks to the existing Cloudflare build commands instead.

Cloudflare build minutes have separate quotas and pricing. Monitor usage in the Cloudflare dashboard.
