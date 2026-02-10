import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { config, validateConfig } from './config';
import { SyncEngine } from './sync/engine';
import { WebhookEmailOpened } from './instantly/client';
import { logger } from './utils/logger';

async function main() {
  logger.info('Starting Willow Education — Instantly → Day.ai Integration (Webhook Mode)');

  validateConfig('webhook');

  const engine = new SyncEngine();
  await engine.initialize();

  const app = express();
  app.use(express.json());

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', mode: 'webhook', timestamp: new Date().toISOString() });
  });

  // Webhook endpoint for Instantly email_opened events
  app.post('/webhook/instantly', async (req, res) => {
    try {
      const payload = req.body as WebhookEmailOpened;

      logger.info(`Webhook received: ${payload.event_type} for ${payload.lead_email}`);

      // Validate it's an email_opened event
      if (payload.event_type !== 'email_opened') {
        logger.debug(`Ignoring event type: ${payload.event_type}`);
        res.status(200).json({ status: 'ignored', reason: 'not email_opened' });
        return;
      }

      // Process asynchronously so we respond to the webhook quickly
      res.status(200).json({ status: 'accepted' });

      // Process the event
      await engine.processWebhookEvent(payload);
    } catch (err) {
      logger.error('Webhook processing error', err);
      // Still return 200 to prevent retries for application errors
      if (!res.headersSent) {
        res.status(200).json({ status: 'error', message: 'Processing failed, will retry' });
      }
    }
  });

  // Manual trigger endpoint (useful for testing)
  app.post('/trigger/:email', async (req, res) => {
    try {
      const email = req.params.email;
      logger.info(`Manual trigger for: ${email}`);
      await engine.handleEmailOpened(email);
      res.json({ status: 'ok', email });
    } catch (err) {
      logger.error('Manual trigger error', err);
      res.status(500).json({
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.listen(config.server.port, () => {
    logger.info(`Webhook server running on port ${config.server.port}`);
    logger.info(`Webhook URL: http://localhost:${config.server.port}/webhook/instantly`);
    logger.info(`Health check: http://localhost:${config.server.port}/health`);
  });
}

main().catch((err) => {
  logger.error('Fatal error', err);
  process.exit(1);
});
