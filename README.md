# Willow Education — Instantly.ai → Day.ai CRM Automation

Monitors the **"klaviyo cleaned sup, CAO list Dec 2025"** campaign in Instantly.ai for email opens, then pushes contact data into Day.ai CRM with automatic deal creation and follow-up actions.

## What it does

When someone **opens an email** in the Instantly campaign:

1. **Extracts** all lead metadata from Instantly (email, name, district, number of students, location, source, etc.)
2. **Creates or updates** the contact in Day.ai CRM
3. **Checks** if the contact has an existing deal in the Sales Pipeline:
   - **No deal** → Creates a new deal in the **"Unqualified Lead"** stage
   - **Has deal** → Updates the deal and creates a follow-up action to send a personalized email

## Deployment (GitHub Actions — Nightly Cron)

This runs automatically every night via GitHub Actions. No server needed.

### Step 1: Initial setup (one-time, on your laptop)

```bash
git clone <this-repo-url>
cd willow_instantly_email_day_ai_crm_automation
npm install
cp .env.example .env
```

Edit `.env` and set `INSTANTLY_API_KEY`.

Then authorize Day.ai:

```bash
npm run oauth:setup
```

This opens a browser for Day.ai authorization and writes `CLIENT_ID`, `CLIENT_SECRET`, and `REFRESH_TOKEN` to your `.env` file.

### Step 2: Add secrets to GitHub

Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

Add these secrets (copy values from your `.env` file):

| Secret Name | Where to find it |
|---|---|
| `INSTANTLY_API_KEY` | Your `.env` file |
| `INSTANTLY_CAMPAIGN_NAME` | Default: `klaviyo cleaned sup, CAO list Dec 2025` |
| `INSTANTLY_SENDING_EMAIL` | Default: `fu@streetlightschools.org` |
| `INTEGRATION_NAME` | Default: `Willow Instantly Integration` |
| `CLIENT_ID` | Your `.env` file (auto-populated by oauth:setup) |
| `CLIENT_SECRET` | Your `.env` file (auto-populated by oauth:setup) |
| `REFRESH_TOKEN` | Your `.env` file (auto-populated by oauth:setup) |
| `DAY_AI_PIPELINE_ID` | Default: `67279be2-3e48-45b1-abfa-ae94a6fe198c` |
| `DAY_AI_STAGE_ID` | Default: `fad7fcba-2b28-4bcd-979e-435779818487` |

### Step 3: Enable the workflow

The nightly sync runs automatically at **2:00 AM EST** every day.

To run it manually: Go to **Actions** tab → **Nightly Instantly → Day.ai Sync** → **Run workflow**.

### Step 4: Verify it works

After the first run, check the **Actions** tab:
- Green checkmark = success
- Red X = something failed (click to see logs)

GitHub sends you an email automatically if a run fails.

## Running locally (for testing)

### Run sync once (same as what GitHub Actions does)

```bash
npm run sync
```

### Run in continuous polling mode (every 5 minutes)

```bash
npm run poll
```

### Trigger a single email manually

```bash
npm run build
npm start &
curl -X POST http://localhost:3000/trigger/someone@example.com
```

## Modes

| Mode | Command | Description |
|------|---------|-------------|
| **Nightly Sync** | `npm run sync` | Runs once, syncs all new opens, exits (used by GitHub Actions) |
| **Polling** | `npm run poll` | Runs continuously, checks every 5 minutes |
| **Webhook** | `npm start` | Express server for real-time webhook events (needs public URL) |
| **Setup** | `npm run setup` | Discovers campaign/pipeline/stage IDs and creates custom fields |
| **OAuth Setup** | `npm run oauth:setup` | One-time Day.ai authorization |

## Troubleshooting

### "Day.ai authorization expired"

Your refresh token has expired. Fix:
1. On your laptop: `npm run oauth:setup`
2. Copy the new `REFRESH_TOKEN` from `.env`
3. Update the `REFRESH_TOKEN` secret in GitHub repo settings

### "Campaign not found"

The campaign name in Instantly may have changed. Update the `INSTANTLY_CAMPAIGN_NAME` secret.

### Duplicate leads

The `data/processed-leads.json` file tracks which emails have been synced. If you need to re-process a lead, delete their entry from this file and push.

### Re-running for a specific email

Locally:
```bash
npm run build && npm start &
curl -X POST http://localhost:3000/trigger/email@example.com
```

## Field Mapping

| Instantly.ai | Day.ai Contact | Day.ai Opportunity |
|---|---|---|
| `email` | `email` | `primaryPerson` |
| `first_name` | `firstName` | — |
| `last_name` | `lastName` | — |
| `company_name` | `currentCompanyName` | — |
| `phone` | `primaryPhoneNumber` | — |
| `custom_variables.location` | `location` | `instantly_location` (custom) |
| `custom_variables.district` | — | `instantly_district` (custom) |
| `custom_variables.number_of_students` | — | `instantly_number_of_students` (custom) |
| `custom_variables.source` | — | `instantly_lead_source` (custom) |

## Project Structure

```
src/
├── index.ts                  # Webhook server entry point
├── poll.ts                   # Polling mode entry point
├── cron.ts                   # Run-once sync (for GitHub Actions / cron)
├── setup.ts                  # One-time setup script
├── config.ts                 # Environment configuration
├── instantly/client.ts       # Instantly API v2 client
├── day/
│   ├── client.ts             # Day.ai MCP/OAuth client
│   └── oauth-setup.ts        # Interactive OAuth setup wizard
├── sync/
│   ├── engine.ts             # Core orchestration logic
│   └── field-mapping.ts      # Instantly → Day.ai field mapping
├── state/store.ts            # JSON-file deduplication store
└── utils/logger.ts           # Logger

.github/workflows/
└── nightly-sync.yml          # GitHub Actions cron (runs at 2 AM EST daily)
```
