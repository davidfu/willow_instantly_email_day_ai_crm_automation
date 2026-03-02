import dotenv from 'dotenv';
dotenv.config();

import { config, validateConfig } from './config';
import { SyncEngine } from './sync/engine';
import { logger } from './utils/logger';

/**
 * Run-once sync: fetch all leads with email opens, process new ones, exit.
 * Designed for cron / GitHub Actions — runs once and stops.
 */
async function main() {
  const startTime = Date.now();
  logger.info('=== Willow Education — Nightly Sync ===');
  logger.info(`Campaign: "${config.instantly.campaignName}"`);

  validateConfig('poll');

  const engine = new SyncEngine();
  await engine.initialize();

  const processed = await engine.pollAndSync();
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  if (processed > 0) {
    logger.info(`✓ Sync complete: ${processed} new lead(s) synced to Day.ai in ${elapsed}s`);
  } else {
    logger.info(`✓ Sync complete: no new leads to process (${elapsed}s)`);
  }

  // Exit cleanly — important for cron/CI environments
  process.exit(0);
}

main().catch((err) => {
  logger.error('Sync failed', err);
  process.exit(1);
});
