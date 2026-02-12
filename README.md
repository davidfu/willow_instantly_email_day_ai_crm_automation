# Willow Education — Instantly.ai → Day.ai CRM Automation

Monitors the **"klaviyo cleaned sup, CAO list Dec 2025"** campaign in Instantly.ai for email opens, then pushes contact data into Day.ai CRM with automatic deal creation and follow-up actions.

## What it does

When someone **opens an email** in the Instantly campaign:

1. **Extracts** all lead metadata from Instantly (email, name, district, number of students, location, source, etc.)
2. **Creates or updates** the contact in Day.ai CRM
3. **Checks** if the contact has an existing deal in the Sales Pipeline:
   - **No deal** → Creates a new deal in the **"Unqualified Lead"** stage
   - **Has deal** → Updates the deal and creates a follow-up action to send a personalized email

## Modes

| Mode | Command | Description |
|------|---------|-------------|
| **Webhook** | `npm start` | Runs an Express server that receives real-time webhook events from Instantly |
| **Polling** | `npm run poll` | Polls Instantly every N minutes for leads with new email opens |
| **Setup** | `npm run setup` | Discovers campaign/pipeline/stage IDs and creates custom fields in Day.ai |
| **OAuth Setup** | `npm run oauth:setup` | One-time Day.ai authorization (auto-populates credentials in .env) |

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure credentials

```bash
cp .env.example .env
```

Edit `.env`:
- Set `INSTANTLY_API_KEY` — your Instantly API key
- Optionally change `INTEGRATION_NAME` (defaults to "Willow Instantly Integration")
- That's it — Day.ai credentials are auto-populated in the next step.

### 3. Authorize Day.ai (one-time)

```bash
npm run oauth:setup
```

This opens a browser window for Day.ai authorization. Once you approve, `CLIENT_ID`, `CLIENT_SECRET`, and `REFRESH_TOKEN` are **automatically written** to your `.env` file.

### 4. Run setup

```bash
npm run setup
```

This will:
- Find the campaign in Instantly and cache its ID
- Find the "Sales Pipeline" and "Unqualified Lead" stage in Day.ai
- Create custom properties in Day.ai for Instantly-specific fields (district, number of students, source, location)

### 5. Start the integration

**Webhook mode** (recommended if you have a public URL):
```bash
npm start
```

Then register the webhook URL in Instantly pointing to `https://your-server.com/webhook/instantly`.

**Polling mode** (no public URL needed):
```bash
npm run poll
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

Empty fields are skipped (not pushed as blank values).

## Project Structure

```
src/
├── index.ts                  # Webhook server entry point
├── poll.ts                   # Polling mode entry point
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
```

## API Endpoints (Webhook Mode)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/webhook/instantly` | Receives Instantly webhook events |
| `POST` | `/trigger/:email` | Manually trigger sync for a specific email |
