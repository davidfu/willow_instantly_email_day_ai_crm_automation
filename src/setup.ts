import dotenv from 'dotenv';
dotenv.config();

import { config, validateConfig } from './config';
import { InstantlyClient } from './instantly/client';
import { DayAiClient } from './day/client';
import { StateStore } from './state/store';
import { logger } from './utils/logger';

/**
 * Setup script: discovers campaign ID, pipeline/stage IDs, and
 * optionally creates custom properties in Day.ai.
 *
 * Run: npm run setup
 */
async function main() {
  logger.info('=== Willow Education Integration Setup ===\n');

  const store = new StateStore();

  // ─── Step 1: Instantly Campaign Discovery ─────────────────────────
  logger.info('Step 1: Instantly.ai — Find campaign\n');

  if (!config.instantly.apiKey) {
    logger.warn('INSTANTLY_API_KEY not set. Skipping Instantly setup.');
    logger.info('Set INSTANTLY_API_KEY in .env and re-run setup.\n');
  } else {
    const instantly = new InstantlyClient();

    try {
      const campaign = await instantly.findCampaignByName(config.instantly.campaignName);
      if (campaign) {
        store.campaignId = campaign.id;
        logger.info(`Found campaign: "${campaign.name}"`);
        logger.info(`Campaign ID: ${campaign.id}`);
        logger.info(`Status: ${campaign.status}`);
      } else {
        logger.error(`Campaign not found: "${config.instantly.campaignName}"`);
        logger.info('Check the campaign name in INSTANTLY_CAMPAIGN_NAME');
      }
    } catch (err) {
      logger.error('Failed to connect to Instantly API', err);
    }

    // List existing webhooks
    try {
      logger.info('\nExisting webhooks:');
      const hooks = await instantly.listWebhooks();
      if (hooks.length === 0) {
        logger.info('  No webhooks registered');
      } else {
        for (const hook of hooks) {
          logger.info(`  ${JSON.stringify(hook)}`);
        }
      }
    } catch (err) {
      logger.error('Failed to list webhooks', err);
    }
  }

  // ─── Step 2: Day.ai Pipeline Discovery ────────────────────────────
  logger.info('\nStep 2: Day.ai — Find pipeline and stage\n');

  if (!config.dayAi.clientId || !config.dayAi.clientSecret || !config.dayAi.refreshToken) {
    logger.warn('Day.ai credentials not configured. Skipping Day.ai setup.');
    logger.info('Set DAY_AI_CLIENT_ID, DAY_AI_CLIENT_SECRET, and DAY_AI_REFRESH_TOKEN in .env');
    logger.info('Then re-run: npm run setup\n');
    printPlaceholderInstructions();
    return;
  }

  const dayAi = new DayAiClient();

  try {
    await dayAi.mcpInitialize();
    logger.info('Day.ai MCP session initialized\n');
  } catch (err) {
    logger.error('Failed to initialize Day.ai MCP session', err);
    logger.info('Check your Day.ai credentials in .env');
    return;
  }

  // Find pipeline
  try {
    const pipeline = await dayAi.findPipelineByName(config.dayAi.pipelineName);
    if (pipeline) {
      store.pipelineId = pipeline.id;
      logger.info(`Found pipeline: "${pipeline.title}" (${pipeline.id})`);

      // Find stage
      const stage = await dayAi.findStageByName(pipeline.id, config.dayAi.stageName);
      if (stage) {
        store.stageId = stage.id;
        logger.info(`Found stage: "${stage.title}" (${stage.id})`);
      } else {
        logger.warn(`Stage "${config.dayAi.stageName}" not found in pipeline.`);
        logger.info('You may need to create this stage or update DAY_AI_STAGE_NAME in .env');
      }
    } else {
      logger.warn(`Pipeline "${config.dayAi.pipelineName}" not found.`);
      logger.info('You may need to create this pipeline or update DAY_AI_PIPELINE_NAME in .env');
    }
  } catch (err) {
    logger.error('Failed to discover pipeline/stage', err);
  }

  // ─── Step 3: Create custom properties ─────────────────────────────
  logger.info('\nStep 3: Day.ai — Create custom properties for Instantly fields\n');

  const customFields = [
    {
      objectTypeId: 'native_opportunity',
      propertyTypeId: 'textarea',
      name: 'instantly_district',
      description: 'School district from Instantly.ai lead data',
    },
    {
      objectTypeId: 'native_opportunity',
      propertyTypeId: 'integer',
      name: 'instantly_number_of_students',
      description: 'Number of students from Instantly.ai lead data',
    },
    {
      objectTypeId: 'native_opportunity',
      propertyTypeId: 'textarea',
      name: 'instantly_lead_source',
      description: 'Lead source from Instantly.ai lead data',
    },
    {
      objectTypeId: 'native_opportunity',
      propertyTypeId: 'textarea',
      name: 'instantly_location',
      description: 'Location from Instantly.ai lead data',
    },
  ];

  for (const field of customFields) {
    try {
      await dayAi.createCustomProperty(field);
      logger.info(`Created custom property: ${field.name}`);
    } catch (err) {
      // May already exist — that's fine
      logger.debug(`Custom property ${field.name} may already exist: ${err}`);
    }
  }

  // ─── Step 4: Read schema ──────────────────────────────────────────
  logger.info('\nStep 4: Day.ai — Read CRM schema (for reference)\n');

  try {
    const schema = await dayAi.readSchema('native_contact');
    logger.info('Contact schema loaded (check debug logs for details)');
    logger.debug('Contact schema', schema);
  } catch (err) {
    logger.debug('Failed to read contact schema', err);
  }

  logger.info('\n=== Setup complete ===');
  logger.info(`Campaign ID: ${store.campaignId || 'NOT SET'}`);
  logger.info(`Pipeline ID: ${store.pipelineId || 'NOT SET'}`);
  logger.info(`Stage ID: ${store.stageId || 'NOT SET'}`);
  logger.info(`Processed leads: ${store.getProcessedCount()}`);
}

function printPlaceholderInstructions(): void {
  logger.info('\n──────────────────────────────────────────');
  logger.info('Day.ai Setup Instructions (when you have credentials):');
  logger.info('──────────────────────────────────────────');
  logger.info('1. Go to day.ai and set up an OAuth integration');
  logger.info('2. Copy CLIENT_ID, CLIENT_SECRET, and REFRESH_TOKEN to .env');
  logger.info('3. Run: npm run setup');
  logger.info('4. This will discover your pipeline/stage IDs and create custom fields');
  logger.info('5. Then run: npm start (webhook) or npm run poll (polling)');
  logger.info('──────────────────────────────────────────\n');
}

main().catch((err) => {
  logger.error('Setup failed', err);
  process.exit(1);
});
