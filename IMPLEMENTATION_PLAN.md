# Deploy Instantly → Day.ai Webhook to Vercel

## Context
You have a working Node.js/Express app that receives Instantly.ai `email_opened` webhooks, fetches lead data, and creates/updates contacts + opportunities in Day.ai CRM via MCP. The goal is to deploy this as a Vercel serverless function so Instantly webhooks hit a public URL and the full flow runs automatically. **No Supabase needed.**

---

## Current State Assessment

### Already Built (core logic - reuse as-is)
| File | What it does |
|---|---|
| `src/instantly/client.ts` | Instantly API v2 client (fetch leads, manage webhooks) |
| `src/day/client.ts` | Day.ai OAuth + MCP/JSON-RPC client (contacts, opps, actions) |
| `src/sync/engine.ts` | Orchestration: webhook → fetch lead → create/update contact → create/update deal |
| `src/sync/field-mapping.ts` | Maps Instantly fields to Day.ai properties |
| `src/utils/logger.ts` | Logging utility |
| `src/config.ts` | Environment config loader |

### Exists but NOT needed for production
| File | Why not needed |
|---|---|
| `src/index.ts` | Express server - replaced by Vercel serverless function |
| `src/poll.ts` | Polling fallback - webhooks make this unnecessary |
| `src/setup.ts` | One-time discovery - already ran, IDs are known |
| `src/day/oauth-setup.ts` | One-time OAuth flow - already completed |
| `src/state/store.ts` | JSON file state - Vercel has no persistent filesystem |
| `data/processed-leads.json` | Local state file - can't persist on Vercel |

### What's Left to Build
1. Vercel serverless function entry point (`api/webhook/instantly.ts`)
2. `vercel.json` configuration
3. Adapt `src/sync/engine.ts` - remove StateStore dependency, simplify init
4. Adapt `src/config.ts` - remove dotenv/Express/polling config, add `INSTANTLY_CAMPAIGN_ID`
5. Replace `node-fetch` with native `fetch` in client files
6. Update `tsconfig.json` for `api/` directory
7. Update `package.json` - remove Express/node-fetch, add `@vercel/node`
8. Register webhook URL in Instantly after deploy

---

## Implementation Plan

### Step 1: Create `vercel.json`
```json
{
  "functions": {
    "api/webhook/instantly.ts": {
      "maxDuration": 30
    }
  }
}
```
The full flow is ~7 sequential HTTP calls (~2-3s total), well within limits.

### Step 2: Create `api/webhook/instantly.ts`
New Vercel serverless function that:
- Accepts POST with Instantly webhook payload
- Validates `event_type === 'email_opened'`
- Creates `SyncEngine`, calls `initialize()` then `handleEmailOpened(email)`
- Returns 200 in all cases (prevents Instantly retries)

Key difference from Express version: must complete processing before returning (no background async). This is fine since the flow takes ~2-3 seconds.

### Step 3: Modify `src/config.ts`
- Remove `import dotenv` / `dotenv.config()` (Vercel injects env vars natively)
- Add `INSTANTLY_CAMPAIGN_ID` as a required field (value: `95e217bf-f7b0-4769-9ad9-b062f92b4caa`)
- Make `pipelineId` and `stageId` required (not optional fallbacks)
- Remove `server` and `polling` sections
- Simplify `validateConfig()` to a single mode

### Step 4: Modify `src/sync/engine.ts`
- Remove `StateStore` import and all usage
- Simplify `initialize()`: read campaign/pipeline/stage IDs directly from config (no discovery, no caching)
- Remove `processWebhookEvent()` method (dedup handled by Day.ai opportunity search in `handleEmailOpened`)
- Remove `pollAndSync()` method
- Remove `this.store.markProcessed()` call from `handleEmailOpened()` (line 153)
- Keep `handleEmailOpened()`, `createNewDeal()`, `updateExistingDeal()` as-is

### Step 5: Replace `node-fetch` with native `fetch`
- `src/instantly/client.ts` line 1: remove `import fetch from 'node-fetch'`
- `src/day/client.ts` line 1: remove `import fetch from 'node-fetch'`
- Native `fetch` is globally available in Node.js 18+ (Vercel's runtime)
- API is compatible; no other code changes needed

### Step 6: Update `tsconfig.json`
- `"target"` → `"ES2022"` (for native fetch types)
- `"lib"` → `["ES2022"]`
- `"rootDir"` → `"."` (was `"./src"`, now includes `api/`)
- `"include"` → `["src/**/*", "api/**/*"]`

### Step 7: Update `package.json`
- Remove from dependencies: `express`, `node-fetch`, `dotenv`
- Remove from devDependencies: `@types/express`, `@types/node-fetch`, `ts-node`, `ts-node-dev`
- Add to devDependencies: `@vercel/node` (for VercelRequest/VercelResponse types)
- Update scripts: keep `build`, remove `start`/`dev`/`poll`/`setup`/`oauth:setup`/`dev:watch`

### Step 8: Update `.gitignore`
- Add `.vercel/` directory

### Step 9: Optional health check
Create `api/health.ts` - simple GET endpoint returning `{ status: 'ok' }`.

### Step 10: Deploy & Register Webhook
1. Deploy via `vercel` CLI or git push
2. Set env vars in Vercel dashboard:
   - `INSTANTLY_API_KEY`, `INSTANTLY_CAMPAIGN_ID` (`95e217bf-f7b0-4769-9ad9-b062f92b4caa`)
   - `CLIENT_ID`, `CLIENT_SECRET`, `REFRESH_TOKEN`
   - `DAY_AI_BASE_URL` (`https://day.ai`), `DAY_AI_PIPELINE_ID`, `DAY_AI_STAGE_ID`
3. Register webhook in Instantly.ai pointing to `https://<project>.vercel.app/api/webhook/instantly`

---

## Key Design Decisions

**No Supabase needed.** The Day.ai opportunity search in `handleEmailOpened()` already prevents duplicate deals. Campaign/pipeline/stage IDs are hardcoded env vars. No persistent state required.

**Token refresh works in serverless.** `DayAiClient.ensureAccessToken()` refreshes on every cold start (~200ms overhead). Day.ai's refresh token appears to be long-lived (standard OAuth2 server-to-server pattern). If token rotation is detected post-deploy, we'd add Vercel KV as a single-key store - but this is unlikely.

**Duplicate webhooks are safe.** If Instantly sends the same event twice, `handleEmailOpened()` searches Day.ai for existing opportunities and updates rather than duplicates. Contact upserts are also idempotent.

---

## Files Changed Summary

| File | Action |
|---|---|
| `api/webhook/instantly.ts` | CREATE - Vercel serverless entry point |
| `api/health.ts` | CREATE - Health check endpoint |
| `vercel.json` | CREATE - Vercel config |
| `src/config.ts` | MODIFY - Remove dotenv, simplify for serverless |
| `src/sync/engine.ts` | MODIFY - Remove StateStore, simplify init |
| `src/instantly/client.ts` | MODIFY - Remove node-fetch import |
| `src/day/client.ts` | MODIFY - Remove node-fetch import |
| `package.json` | MODIFY - Update dependencies |
| `tsconfig.json` | MODIFY - Include api/, target ES2022 |
| `.gitignore` | MODIFY - Add .vercel/ |

No files deleted (keep old files for reference - they just won't be used).

---

## Verification
1. `npx tsc --noEmit` - TypeScript compiles without errors
2. `vercel dev` - Test locally with a simulated webhook POST to `/api/webhook/instantly`
3. Deploy to Vercel, check deployment logs
4. Send test POST to the live URL with a mock `email_opened` payload
5. Verify contact + opportunity appear in Day.ai CRM
6. Register the Instantly webhook and wait for a real email open event

---

## Architecture Diagram

```
Instantly.ai (email_opened webhook)
        │
        ▼
Vercel Serverless Function (api/webhook/instantly.ts)
        │
        ├─→ Validate event_type === 'email_opened'
        │
        ├─→ SyncEngine.initialize()
        │     └─ Read config (campaign/pipeline/stage IDs from env vars)
        │     └─ DayAiClient.mcpInitialize() (OAuth token refresh + MCP handshake)
        │
        └─→ SyncEngine.handleEmailOpened(email)
              │
              ├─→ InstantlyClient.findLeadByEmail() → fetch full lead data
              │
              ├─→ DayAiClient.searchContactByEmail()
              │     └─ Create or Update contact in Day.ai
              │
              └─→ DayAiClient.searchOpportunitiesByContact()
                    ├─ No deal → createOpportunity() in "Unqualified Lead" stage
                    └─ Deal exists → updateOpportunity() + createFollowUpAction()
```

## Environment Variables (for Vercel Dashboard)

| Variable | Value | Source |
|---|---|---|
| `INSTANTLY_API_KEY` | `MTg5Y2FhMmYt...` | .env |
| `INSTANTLY_CAMPAIGN_ID` | `95e217bf-f7b0-4769-9ad9-b062f92b4caa` | data/processed-leads.json |
| `INSTANTLY_CAMPAIGN_NAME` | `klaviyo cleaned sup, CAO list Dec 2025` | .env (logging only) |
| `CLIENT_ID` | `11545c3c-86d9-4e5b-b59a-8c4998c5b8db` | .env |
| `CLIENT_SECRET` | `b689f4d3...` | .env |
| `REFRESH_TOKEN` | `4253ea3f...` | .env |
| `DAY_AI_BASE_URL` | `https://day.ai` | .env |
| `DAY_AI_PIPELINE_ID` | `67279be2-3e48-45b1-abfa-ae94a6fe198c` | .env |
| `DAY_AI_STAGE_ID` | `fad7fcba-2b28-4bcd-979e-435779818487` | .env |
