import fetch from 'node-fetch';
import { config } from '../config';
import { logger } from '../utils/logger';

// ─── Types ───────────────────────────────────────────────────────────

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

interface McpToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

interface McpResponse {
  result?: McpToolResult;
  error?: { code: number; message: string };
}

export interface DayContact {
  email: string;
  firstName?: string;
  lastName?: string;
  currentCompanyName?: string;
  primaryPhoneNumber?: string;
  location?: string;
  [key: string]: unknown;
}

export interface DayPipeline {
  id: string;
  title: string;
  [key: string]: unknown;
}

export interface DayStage {
  id: string;
  title: string;
  pipelineId: string;
  [key: string]: unknown;
}

export interface DayOpportunity {
  id: string;
  title: string;
  stageId: string;
  [key: string]: unknown;
}

// ─── Client ──────────────────────────────────────────────────────────

export class DayAiClient {
  private baseUrl: string;
  private clientId: string;
  private clientSecret: string;
  private refreshToken: string;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;
  private mcpSessionId: string | null = null;
  private jsonRpcId: number = 0;

  constructor() {
    this.baseUrl = config.dayAi.baseUrl;
    this.clientId = config.dayAi.clientId;
    this.clientSecret = config.dayAi.clientSecret;
    this.refreshToken = config.dayAi.refreshToken;
  }

  // ─── Auth ──────────────────────────────────────────────────────────

  private async ensureAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && now < this.tokenExpiresAt - 60_000) {
      return this.accessToken;
    }

    logger.info('Refreshing Day.ai access token...');

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: this.refreshToken,
    });

    const res = await fetch(`${this.baseUrl}/api/oauth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Day.ai token refresh failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as TokenResponse;
    this.accessToken = data.access_token;
    this.tokenExpiresAt = now + data.expires_in * 1000;

    if (data.refresh_token) {
      this.refreshToken = data.refresh_token;
    }

    logger.info('Day.ai access token refreshed successfully');
    return this.accessToken;
  }

  // ─── MCP Transport ────────────────────────────────────────────────

  async mcpInitialize(): Promise<void> {
    const token = await this.ensureAccessToken();
    const body = {
      jsonrpc: '2.0',
      id: ++this.jsonRpcId,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'willow-instantly-integration', version: '1.0.0' },
      },
    };

    const res = await fetch(`${this.baseUrl}/api/mcp`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Day.ai MCP initialize failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as Record<string, unknown>;
    logger.info('Day.ai MCP session initialized', data);
  }

  async mcpCallTool(toolName: string, args: Record<string, unknown> = {}): Promise<McpToolResult> {
    const token = await this.ensureAccessToken();
    const body = {
      jsonrpc: '2.0',
      id: ++this.jsonRpcId,
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    };

    logger.debug(`Day.ai MCP call: ${toolName}`, args);

    const res = await fetch(`${this.baseUrl}/api/mcp`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Day.ai MCP call failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as McpResponse;

    if (data.error) {
      throw new Error(`Day.ai MCP error: ${data.error.message} (code: ${data.error.code})`);
    }

    if (!data.result) {
      throw new Error('Day.ai MCP returned no result');
    }

    if (data.result.isError) {
      const errorText = data.result.content?.[0]?.text || 'Unknown MCP tool error';
      throw new Error(`Day.ai tool error: ${errorText}`);
    }

    return data.result;
  }

  private parseResult(result: McpToolResult): unknown {
    const text = result.content?.[0]?.text;
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  /**
   * Extract an array of objects from a search_objects response.
   * Day.ai MCP returns: { native_type: { results: [...], totalCount: N }, hasMore, nextOffset }
   */
  private extractSearchResults(parsed: unknown, objectType: string): unknown[] {
    if (!parsed) return [];
    if (Array.isArray(parsed)) return parsed;

    const obj = parsed as Record<string, unknown>;

    // Primary format: { native_pipeline: { results: [...] } }
    if (obj[objectType] && typeof obj[objectType] === 'object') {
      const typed = obj[objectType] as Record<string, unknown>;
      if (Array.isArray(typed.results)) return typed.results;
      // If the value itself is an array
      if (Array.isArray(obj[objectType])) return obj[objectType] as unknown[];
    }

    // Fallback: top-level results array
    if (Array.isArray(obj.results)) return obj.results;

    // Fallback: look for any nested { results: [...] } in any key
    for (const [key, val] of Object.entries(obj)) {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        const inner = val as Record<string, unknown>;
        if (Array.isArray(inner.results) && inner.results.length > 0) {
          logger.debug(`Found results under key "${key}" instead of "${objectType}"`);
          return inner.results;
        }
      }
    }

    // Last resort: look for any array value
    for (const val of Object.values(obj)) {
      if (Array.isArray(val) && val.length > 0) return val;
    }

    logger.debug(`Could not extract array for ${objectType} from response`, JSON.stringify(parsed).substring(0, 500));
    return [];
  }

  // ─── Contact Operations ───────────────────────────────────────────

  async searchContactByEmail(email: string): Promise<DayContact | null> {
    const result = await this.mcpCallTool('search_objects', {
      description: `Find contact by email: ${email}`,
      queries: [{
        objectType: 'native_contact',
        where: {
          propertyId: 'email',
          operator: 'eq',
          value: email,
        },
      }],
      propertiesToReturn: '*',
      includeRelationships: true,
    });

    const parsed = this.parseResult(result);
    const contacts = this.extractSearchResults(parsed, 'native_contact');
    if (contacts.length === 0) return null;
    return contacts[0] as DayContact;
  }

  async createContact(properties: Record<string, unknown>): Promise<unknown> {
    const result = await this.mcpCallTool('create_or_update_person_organization', {
      objectType: 'native_contact',
      standardProperties: properties,
    });
    return this.parseResult(result);
  }

  async updateContact(email: string, properties: Record<string, unknown>): Promise<unknown> {
    const result = await this.mcpCallTool('create_or_update_person_organization', {
      objectType: 'native_contact',
      standardProperties: { ...properties, email },
    });
    return this.parseResult(result);
  }

  // ─── Pipeline Operations ──────────────────────────────────────────

  async findPipelineByName(name: string): Promise<DayPipeline | null> {
    const result = await this.mcpCallTool('search_objects', {
      description: `Find pipeline: ${name}`,
      queries: [{
        objectType: 'native_pipeline',
      }],
      propertiesToReturn: '*',
    });

    const parsed = this.parseResult(result);
    const pipelines = this.extractSearchResults(parsed, 'native_pipeline') as DayPipeline[];
    logger.debug(`Found ${pipelines.length} pipelines`, pipelines.map(p => ({ id: p.id, title: p.title })));
    return pipelines.find(
      (p) => p.title?.toLowerCase() === name.toLowerCase()
    ) || null;
  }

  async findStageByName(pipelineId: string, stageName: string): Promise<DayStage | null> {
    const result = await this.mcpCallTool('search_objects', {
      description: `Find stage '${stageName}' in pipeline`,
      queries: [{
        objectType: 'native_stage',
        where: {
          propertyId: 'pipelineId',
          operator: 'eq',
          value: pipelineId,
        },
      }],
      propertiesToReturn: '*',
    });

    const parsed = this.parseResult(result);
    const stages = this.extractSearchResults(parsed, 'native_stage') as DayStage[];
    logger.debug(`Found ${stages.length} stages`, stages.map(s => ({ id: s.id, title: s.title })));
    return stages.find(
      (s) => s.title?.toLowerCase() === stageName.toLowerCase()
    ) || null;
  }

  // ─── Opportunity (Deal) Operations ────────────────────────────────

  async searchOpportunitiesByContact(email: string): Promise<DayOpportunity[]> {
    const result = await this.mcpCallTool('search_objects', {
      description: `Find deals involving ${email}`,
      queries: [{
        objectType: 'native_opportunity',
        where: {
          relationship: 'attendee',
          targetObjectType: 'native_contact',
          targetObjectId: email,
        },
      }],
      propertiesToReturn: '*',
      includeRelationships: true,
    });

    const parsed = this.parseResult(result);
    return this.extractSearchResults(parsed, 'native_opportunity') as DayOpportunity[];
  }

  async createOpportunity(params: {
    title: string;
    stageId: string;
    domain?: string;
    primaryPerson: string;
    description?: string;
    organizationName?: string;
    currentStatus?: string;
    customProperties?: Array<{ propertyId: string; value: unknown }>;
  }): Promise<unknown> {
    const result = await this.mcpCallTool('create_or_update_opportunity', {
      standardProperties: {
        title: params.title,
        stageId: params.stageId,
        domain: params.domain || '',
        description: params.description,
        organizationName: params.organizationName,
        currentStatus: params.currentStatus || 'New lead from Instantly.ai email campaign',
      },
      roles: [{
        personEmail: params.primaryPerson,
        roles: ['PRIMARY_CONTACT'],
      }],
    });
    return this.parseResult(result);
  }

  async updateOpportunity(
    opportunityId: string,
    updates: Record<string, unknown>
  ): Promise<unknown> {
    const result = await this.mcpCallTool('create_or_update_opportunity', {
      objectId: opportunityId,
      standardProperties: updates,
    });
    return this.parseResult(result);
  }

  // ─── Actions ──────────────────────────────────────────────────────

  async createFollowUpAction(params: {
    contactEmail: string;
    opportunityId?: string;
    title: string;
    descriptionPoints: string[];
  }): Promise<unknown> {
    const args: Record<string, unknown> = {
      title: params.title,
      assignedToAssistant: false,
      type: 'FOLLOW_UP',
      status: 'UNREAD',
      priority: 'HIGH',
      people: [params.contactEmail],
      descriptionPoints: params.descriptionPoints,
    };

    if (params.opportunityId) {
      args.opportunityIds = [params.opportunityId];
    }

    const result = await this.mcpCallTool('create_or_update_action', args);
    return this.parseResult(result);
  }

  // ─── Email ────────────────────────────────────────────────────────

  async createAndSendEmail(params: {
    to: string[];
    subject: string;
    htmlBody: string;
  }): Promise<unknown> {
    const draftResult = await this.mcpCallTool('create_email_draft', {
      to: params.to,
      subject: params.subject,
      htmlBody: params.htmlBody,
    });

    const draftData = this.parseResult(draftResult) as { draftId?: string } | null;
    if (!draftData?.draftId) {
      throw new Error('Failed to create email draft — no draftId returned');
    }

    const sendResult = await this.mcpCallTool('send_email', {
      draftId: draftData.draftId,
    });
    return this.parseResult(sendResult);
  }

  // ─── Custom Properties ────────────────────────────────────────────

  async createCustomProperty(params: {
    objectTypeId: string;
    propertyTypeId: string;
    name: string;
    description: string;
  }): Promise<unknown> {
    const result = await this.mcpCallTool('create_custom_property', {
      objectTypeId: params.objectTypeId,
      propertyTypeId: params.propertyTypeId,
      name: params.name,
      description: params.description,
      aiManaged: false,
      useWeb: false,
    });
    return this.parseResult(result);
  }

  // ─── Schema ───────────────────────────────────────────────────────

  async readSchema(objectType: string): Promise<unknown> {
    const result = await this.mcpCallTool('read_crm_schema', {
      objectType,
      includeOptions: true,
    });
    return this.parseResult(result);
  }
}
