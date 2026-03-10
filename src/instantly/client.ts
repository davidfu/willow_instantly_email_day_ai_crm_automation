import fetch from 'node-fetch';
import { config } from '../config';
import { logger } from '../utils/logger';

// ─── Types ───────────────────────────────────────────────────────────

export interface InstantlyCampaign {
  id: string;
  name: string;
  status: number;
  timestamp_created: string;
  timestamp_updated: string;
}

export interface InstantlyLead {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  company_name: string;
  phone: string;
  website: string;
  campaign: string;
  status: number;
  interest_status: string;
  email_open_count: number;
  email_reply_count: number;
  custom_variables: Record<string, string | number | boolean | null>;
  timestamp_created: string;
  timestamp_updated: string;
}

export interface WebhookEmailOpened {
  timestamp: string;
  event_type: 'email_opened';
  workspace: string;
  campaign_id: string;
  campaign_name: string;
  lead_email: string;
  email_account: string;
  step: number;
  variant: number;
  is_first: boolean;
  email_id?: string;
}

interface PaginatedResponse<T> {
  items: T[];
  next_starting_after?: string | null;
}

// ─── Client ──────────────────────────────────────────────────────────

export class InstantlyClient {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = config.instantly.baseUrl;
    this.apiKey = config.instantly.apiKey;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    logger.debug(`Instantly API ${method} ${path}`);

    const res = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Instantly API error ${res.status}: ${text}`);
    }

    return res.json() as Promise<T>;
  }

  /**
   * Find a campaign by name. Returns the first match.
   */
  async findCampaignByName(name: string): Promise<InstantlyCampaign | null> {
    const data = await this.request<PaginatedResponse<InstantlyCampaign>>(
      'GET',
      `/campaigns?search=${encodeURIComponent(name)}&limit=10`
    );

    const match = data.items.find(
      (c) => c.name.toLowerCase() === name.toLowerCase()
    );
    return match || data.items[0] || null;
  }

  /**
   * Get a campaign by its UUID.
   */
  async getCampaign(id: string): Promise<InstantlyCampaign> {
    return this.request<InstantlyCampaign>('GET', `/campaigns/${id}`);
  }

  /**
   * List all leads in a campaign. Handles pagination automatically.
   * Optionally filter by leads that have opened emails.
   */
  async listLeads(
    campaignId: string,
    options: { onlyOpened?: boolean; limit?: number } = {}
  ): Promise<InstantlyLead[]> {
    const allLeads: InstantlyLead[] = [];
    let startingAfter: string | null = null;
    const pageSize = options.limit || 100;

    do {
      const body: Record<string, unknown> = {
        campaign_id: campaignId,
        limit: pageSize,
      };
      if (startingAfter) {
        body.starting_after = startingAfter;
      }

      const data = await this.request<{
        items: InstantlyLead[];
        next_starting_after?: string | null;
      }>('POST', '/leads/list', body);

      for (const lead of data.items) {
        if (options.onlyOpened && lead.email_open_count === 0) continue;
        allLeads.push(lead);
      }

      startingAfter = data.next_starting_after || null;
    } while (startingAfter);

    return allLeads;
  }

  /**
   * Get a single lead by ID.
   */
  async getLead(id: string): Promise<InstantlyLead> {
    return this.request<InstantlyLead>('GET', `/leads/${id}`);
  }

  /**
   * Get lead details by searching for the email within a specific campaign.
   * Returns the first matching lead.
   */
  async findLeadByEmail(
    campaignId: string,
    email: string
  ): Promise<InstantlyLead | null> {
    const body = {
      campaign_id: campaignId,
      search: email,
      limit: 1,
    };

    const data = await this.request<{ items: InstantlyLead[] }>(
      'POST',
      '/leads/list',
      body
    );

    return data.items[0] || null;
  }

  /**
   * Register a new webhook for email_opened events.
   */
  async createWebhook(targetUrl: string): Promise<{ id: string }> {
    return this.request<{ id: string }>('POST', '/webhooks', {
      event_type: 'email_opened',
      target_hook_url: targetUrl,
    });
  }

  /**
   * List all registered webhooks.
   */
  async listWebhooks(): Promise<unknown[]> {
    const data = await this.request<{ items: unknown[] }>('GET', '/webhooks?limit=100');
    return data.items;
  }
}
