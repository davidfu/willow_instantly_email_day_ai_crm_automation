import { InstantlyClient, InstantlyLead, WebhookEmailOpened } from '../instantly/client';
import { DayAiClient } from '../day/client';
import { StateStore } from '../state/store';
import { config } from '../config';
import { logger } from '../utils/logger';
import {
  mapLeadToContactProperties,
  mapLeadToOpportunityCustomProps,
  buildDealTitle,
  buildDealDescription,
} from './field-mapping';

export class SyncEngine {
  private instantly: InstantlyClient;
  private dayAi: DayAiClient;
  private store: StateStore;
  private campaignId: string | null = null;
  private pipelineId: string | null = null;
  private stageId: string | null = null;

  constructor() {
    this.instantly = new InstantlyClient();
    this.dayAi = new DayAiClient();
    this.store = new StateStore();
  }

  /**
   * Initialize: find campaign, discover pipeline/stage, init Day.ai MCP session.
   */
  async initialize(): Promise<void> {
    logger.info('Initializing sync engine...');

    // Resolve campaign ID
    this.campaignId = this.store.campaignId;
    if (!this.campaignId) {
      logger.info(`Looking up campaign: "${config.instantly.campaignName}"`);
      const campaign = await this.instantly.findCampaignByName(config.instantly.campaignName);
      if (!campaign) {
        throw new Error(`Campaign not found: "${config.instantly.campaignName}"`);
      }
      this.campaignId = campaign.id;
      this.store.campaignId = campaign.id;
      logger.info(`Found campaign: ${campaign.name} (${campaign.id})`);
    } else {
      logger.info(`Using cached campaign ID: ${this.campaignId}`);
    }

    // Initialize Day.ai MCP session
    logger.info('Initializing Day.ai MCP session...');
    await this.dayAi.mcpInitialize();

    // Resolve pipeline and stage
    await this.resolvePipelineAndStage();

    logger.info('Sync engine initialized successfully');
  }

  private async resolvePipelineAndStage(): Promise<void> {
    this.pipelineId = this.store.pipelineId;
    this.stageId = this.store.stageId;

    if (this.pipelineId && this.stageId) {
      logger.info(`Using cached pipeline/stage: ${this.pipelineId} / ${this.stageId}`);
      return;
    }

    // Try to discover pipeline dynamically
    logger.info(`Looking up pipeline: "${config.dayAi.pipelineName}"`);
    try {
      const pipeline = await this.dayAi.findPipelineByName(config.dayAi.pipelineName);
      if (pipeline) {
        this.pipelineId = pipeline.id;
        this.store.pipelineId = pipeline.id;
        logger.info(`Found pipeline: ${pipeline.title} (${pipeline.id})`);

        const stage = await this.dayAi.findStageByName(pipeline.id, config.dayAi.stageName);
        if (stage) {
          this.stageId = stage.id;
          this.store.stageId = stage.id;
          logger.info(`Found stage: ${stage.title} (${stage.id})`);
          return;
        }
      }
    } catch (err) {
      logger.warn('Dynamic pipeline/stage discovery failed, using hardcoded fallbacks', err);
    }

    // Fallback to hardcoded IDs from config
    if (!this.pipelineId && config.dayAi.pipelineId) {
      this.pipelineId = config.dayAi.pipelineId;
      this.store.pipelineId = config.dayAi.pipelineId;
      logger.info(`Using hardcoded pipeline ID: ${this.pipelineId}`);
    }
    if (!this.stageId && config.dayAi.stageId) {
      this.stageId = config.dayAi.stageId;
      this.store.stageId = config.dayAi.stageId;
      logger.info(`Using hardcoded stage ID: ${this.stageId}`);
    }

    if (!this.pipelineId || !this.stageId) {
      throw new Error(
        'Could not resolve pipeline/stage. Set DAY_AI_PIPELINE_ID and DAY_AI_STAGE_ID in .env'
      );
    }
  }

  /**
   * Handle a single email-opened event (from webhook or poll).
   */
  async handleEmailOpened(leadEmail: string): Promise<void> {
    logger.info(`Processing email open for: ${leadEmail}`);

    if (!this.campaignId) throw new Error('Sync engine not initialized');
    if (!this.pipelineId || !this.stageId) throw new Error('Pipeline/stage not resolved');

    // 1. Fetch full lead metadata from Instantly
    const lead = await this.instantly.findLeadByEmail(this.campaignId, leadEmail);
    if (!lead) {
      logger.warn(`Lead not found in Instantly for email: ${leadEmail}`);
      return;
    }

    logger.info(`Found lead in Instantly: ${lead.first_name} ${lead.last_name} <${lead.email}>`);

    // 2. Create or update contact in Day.ai
    const contactProps = mapLeadToContactProperties(lead);
    const existingContact = await this.dayAi.searchContactByEmail(leadEmail);

    if (existingContact) {
      logger.info(`Contact already exists in Day.ai: ${leadEmail}`);
      // Update with latest data from Instantly
      await this.dayAi.updateContact(leadEmail, contactProps);
      logger.info(`Updated contact: ${leadEmail}`);
    } else {
      logger.info(`Creating new contact in Day.ai: ${leadEmail}`);
      await this.dayAi.createContact(contactProps);
      logger.info(`Created contact: ${leadEmail}`);
    }

    // 3. Check if deal exists in pipeline
    const existingDeals = await this.dayAi.searchOpportunitiesByContact(leadEmail);
    const customProps = mapLeadToOpportunityCustomProps(lead);

    if (existingDeals.length === 0) {
      // 3a. No deal → Create new deal in Unqualified Lead stage
      await this.createNewDeal(lead, customProps);
    } else {
      // 3b. Deal exists → Update and create follow-up action
      await this.updateExistingDeal(lead, existingDeals[0], customProps);
    }

    // Mark as processed
    this.store.markProcessed(leadEmail, true);
    logger.info(`Successfully processed: ${leadEmail}`);
  }

  private async createNewDeal(
    lead: InstantlyLead,
    customProps: Array<{ propertyId: string; value: unknown }>
  ): Promise<void> {
    const title = buildDealTitle(lead);
    const description = buildDealDescription(lead);

    // Extract domain from email for the deal
    const domain = lead.email.split('@')[1] || '';

    logger.info(`Creating new deal: "${title}"`);

    await this.dayAi.createOpportunity({
      title,
      stageId: this.stageId!,
      domain,
      primaryPerson: lead.email,
      description,
      organizationName: lead.company_name || (lead.custom_variables?.district as string) || '',
      currentStatus: 'New lead — opened email in Instantly campaign',
    });

    logger.info(`Created deal: "${title}" in Unqualified Lead stage`);
  }

  private async updateExistingDeal(
    lead: InstantlyLead,
    existingDeal: { id: string; title: string; [key: string]: unknown },
    customProps: Array<{ propertyId: string; value: unknown }>
  ): Promise<void> {
    logger.info(`Updating existing deal: "${existingDeal.title}" (${existingDeal.id})`);

    // Update deal description with latest engagement data
    const description = buildDealDescription(lead);
    await this.dayAi.updateOpportunity(existingDeal.id, {
      currentStatus: `Re-engaged — opened email on ${new Date().toISOString().split('T')[0]}`,
      description,
    });

    // Create a follow-up action to send personalized email
    const contactName = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email;
    await this.dayAi.createFollowUpAction({
      contactEmail: lead.email,
      opportunityId: existingDeal.id,
      title: `${contactName} needs personalized follow-up email`,
      descriptionPoints: [
        `${contactName} opened an email in the Willow Education campaign.`,
        `Campaign: ${lead.campaign || config.instantly.campaignName}`,
        `Email opens: ${lead.email_open_count || 1}`,
        `Send a direct, personalized email to re-engage this contact.`,
        lead.company_name ? `Company: ${lead.company_name}` : '',
        lead.custom_variables?.district ? `District: ${lead.custom_variables.district}` : '',
      ].filter(Boolean),
    });

    logger.info(`Created follow-up action for: ${lead.email}`);
  }

  /**
   * Process a webhook payload from Instantly.
   */
  async processWebhookEvent(payload: WebhookEmailOpened): Promise<void> {
    if (payload.event_type !== 'email_opened') {
      logger.debug(`Ignoring non-open event: ${payload.event_type}`);
      return;
    }

    // Check if already processed (dedup)
    if (this.store.isProcessed(payload.lead_email)) {
      logger.info(`Already processed: ${payload.lead_email}, skipping`);
      return;
    }

    await this.handleEmailOpened(payload.lead_email);
  }

  /**
   * Poll for all leads with opens and process any new ones.
   */
  async pollAndSync(): Promise<number> {
    if (!this.campaignId) throw new Error('Sync engine not initialized');

    logger.info('Polling for leads with email opens...');
    const leads = await this.instantly.listLeads(this.campaignId, { onlyOpened: true });

    let processed = 0;
    for (const lead of leads) {
      if (this.store.isProcessed(lead.email)) {
        continue;
      }

      try {
        await this.handleEmailOpened(lead.email);
        processed++;
      } catch (err) {
        logger.error(`Failed to process lead: ${lead.email}`, err);
      }
    }

    logger.info(`Poll complete. Processed ${processed} new leads (${leads.length} total with opens)`);
    return processed;
  }
}
