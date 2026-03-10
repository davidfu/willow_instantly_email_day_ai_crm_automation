import { InstantlyClient, InstantlyLead } from '../instantly/client';
import { DayAiClient } from '../day/client';
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
  private campaignId: string;
  private pipelineId: string;
  private stageId: string;

  constructor() {
    this.instantly = new InstantlyClient();
    this.dayAi = new DayAiClient();
    this.campaignId = config.instantly.campaignId;
    this.pipelineId = config.dayAi.pipelineId;
    this.stageId = config.dayAi.stageId;
  }

  /**
   * Initialize: refresh Day.ai token and MCP handshake.
   */
  async initialize(): Promise<void> {
    logger.info('Initializing sync engine...');
    logger.info(`Campaign ID: ${this.campaignId}`);
    logger.info(`Pipeline ID: ${this.pipelineId}, Stage ID: ${this.stageId}`);

    await this.dayAi.mcpInitialize();

    logger.info('Sync engine initialized successfully');
  }

  /**
   * Handle a single email-opened event.
   */
  async handleEmailOpened(leadEmail: string): Promise<void> {
    logger.info(`Processing email open for: ${leadEmail}`);

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
      await this.createNewDeal(lead, customProps);
    } else {
      await this.updateExistingDeal(lead, existingDeals[0], customProps);
    }

    logger.info(`Successfully processed: ${leadEmail}`);
  }

  private async createNewDeal(
    lead: InstantlyLead,
    customProps: Array<{ propertyId: string; value: unknown }>
  ): Promise<void> {
    const title = buildDealTitle(lead);
    const description = buildDealDescription(lead);
    const domain = lead.email.split('@')[1] || '';

    logger.info(`Creating new deal: "${title}"`);

    await this.dayAi.createOpportunity({
      title,
      stageId: this.stageId,
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

    const description = buildDealDescription(lead);
    await this.dayAi.updateOpportunity(existingDeal.id, {
      currentStatus: `Re-engaged — opened email on ${new Date().toISOString().split('T')[0]}`,
      description,
    });

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
}
