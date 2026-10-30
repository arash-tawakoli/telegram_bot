# NexaLabs Cloudflare CI Runner

This project replaces GitHub-hosted Actions runners for the NexaLabs repositories:

- `arash-tawakoli/telegram_bot`
- `arash-tawakoli/website_traumwohnung`

GitHub remains the source-control and pull-request system. A GitHub App sends signed webhooks to this Worker. Cloudflare Workflows durably orchestrates each run, and an isolated Cloudflare Container downloads the exact commit archive and executes the repository-specific checks.

## Security boundaries

- GitHub webhook HMAC-SHA256 is verified before parsing or scheduling a job.
- Only the two allowlisted repositories are accepted.
- Push events run only for `main`; pull-request events run only for same-repository branches. Fork PRs are rejected.
- The GitHub App private key and installation token remain in the Worker/Workflow runtime. They are never passed to the Container.
- The Container receives only a source archive and non-secret job metadata.
- The optional Supabase Management API token remains in the Worker. The Worker compares the live function inventory itself; it is never passed to the Container.
- The Container has outbound Internet access for npm installs, but no GitHub or Supabase credentials.
- Container concurrency is capped at three `standard-2` instances. Each instance sleeps after 30 seconds of inactivity.

## Free-plan preparation and Paid-plan activation

Cloudflare Workflows are available on Workers Free. Containers require Workers Paid. The project is deliberately prepared with both bindings, but cannot be deployed until the account has Workers Paid enabled.

No Paid subscription is activated by this repository.

### 1. Install and test locally

From this directory:

```sh
npm install
npm test
npx wrangler types
npx wrangler deploy --dry-run
```

The dry-run checks the Worker bundle and Wrangler configuration. A production deploy requires Workers Paid because the configuration provisions a Container.

### 2. Create a GitHub App

Create one GitHub App for the NexaLabs organization/account and install it on both repositories.

Required repository permissions:

- Contents: Read-only
- Commit statuses: Read and write
- Metadata: Read-only

Subscribe to webhook events:

- Push
- Pull request

Set the App webhook URL to the deployed Worker's `/github/webhook` endpoint. Generate a strong webhook secret and keep it private.

Record:

- GitHub App ID
- Installation ID
- App private key (PEM)
- Webhook secret

Do not use a personal access token. The Worker creates short-lived installation tokens automatically.

### 3. Deploy after upgrading Workers Paid

```sh
cd cloudflare/ci-runner
npm ci
npx wrangler deploy
npx wrangler secret put GITHUB_APP_ID
npx wrangler secret put GITHUB_INSTALLATION_ID
npx wrangler secret put GITHUB_APP_PRIVATE_KEY
npx wrangler secret put GITHUB_WEBHOOK_SECRET
```

Optional live Supabase inventory comparison:

```sh
npx wrangler secret put SUPABASE_ACCESS_TOKEN
```

The Supabase token is used only by the Worker to call the Supabase Management API. It is never injected into the build Container.

### 4. Configure GitHub App installation

Install the App on both repositories and configure the webhook endpoint:

`https://<worker-subdomain>.workers.dev/github/webhook`

Enable Push and Pull request events. The Worker creates a commit status named:

`Cloudflare CI / tests`

After the first successful run, configure this status as a required check in each repository's branch protection/ruleset.

### 5. Retire GitHub-hosted runner workflow

The existing `.github/workflows/architecture-check.yml` is changed to manual-only on this branch. Do not merge this branch until:

1. Workers Paid is enabled.
2. The Worker deploys successfully.
3. Both GitHub App webhooks are configured.
4. A pull request and a main-branch push both produce the expected Cloudflare commit status.

## Checks executed

### Telegram Bot

- `npm ci --ignore-scripts`
- `npm test`
- `RUNTIME_HASH_STRICT=1 node scripts/check-runtime.mjs`
- Cloudflare CI runner contract tests
- High-confidence committed-secret scan
- Optional live Supabase function inventory comparison from the Worker

### Website

- Coach Portal OCR/UI tests, build, parity and browser-secret checks
- Platform Connect dependency install, syntax and tests
- Coach Portal Bridge syntax and tests
- Public website build and release verification

The runner does not deploy application Workers. Application deployment remains a separate Cloudflare deployment workflow and is not mixed with untrusted pull-request test execution.
