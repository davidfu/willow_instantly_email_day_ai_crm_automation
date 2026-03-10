import dotenv from 'dotenv';
dotenv.config();

import { config, validateConfig } from './config';
import { SyncEngine } from './sync/engine';
import { logger } from './utils/logger';

async function main() {
  logger.info('Starting Willow Education — Instantly → Day.ai Integration (Polling Mode)');
  logger.info(`Poll interval: every ${config.polling.intervalMinutes} minutes`);

  validateConfig('poll');

  const engine = new SyncEngine();
  await engine.initialize();

  // Run immediately on start
  await runPoll(engine);

  // Then schedule recurring polls
  const intervalMs = config.polling.intervalMinutes * 60 * 1000;
  setInterval(() => runPoll(engine), intervalMs);

  logger.info(`Polling active. Next poll in ${config.polling.intervalMinutes} minutes.`);
}

async function runPoll(engine: SyncEngine): Promise<void> {
  try {
    const processed = await engine.pollAndSync();
    if (processed > 0) {
      logger.info(`Poll cycle complete: ${processed} new leads synced to Day.ai`);
    } else {
      logger.info('Poll cycle complete: no new leads to process');
    }
  } catch (err) {
    logger.error('Poll cycle failed', err);
  }
}

main().catch((err) => {
  logger.error('Fatal error', err);
  process.exit(1);
});
