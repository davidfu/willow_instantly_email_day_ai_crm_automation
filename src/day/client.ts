import * as fs from 'fs';
import * as path from 'path';
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
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          `Day.ai authorization expired (${res.status}). ` +
          `Your refresh token is no longer valid.\n` +
          `To fix: run "npm run oauth:setup" locally to re-authorize, ` +
          `then update the REFRESH_TOKEN in your GitHub repo secrets.\n` +
          `Response: ${text}`
        );
      }
      throw new Error(`Day.ai token refresh failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as TokenResponse;
    this.accessToken = data.access_token;
    this.tokenExpiresAt = now + data.expires_in * 1000;

    if (data.refresh_token && data.refresh_token !== this.refreshToken) {
      logger.info('Day.ai rotated refresh token — persisting new token to .env');
      this.refreshToken = data.refresh_token;
      this.persistRefreshToken(data.refresh_token);
    }

    logger.info('Day.ai access token refreshed successfully');
    return this.accessToken;
  }

  /**
   * Persist a rotated refresh token back to .env so it survives restarts.
   */
  private persistRefreshToken(newToken: string): void {
    try {
      const envPath = path.join(process.cwd(), '.env');
      if (!fs.existsSync(envPath)) return;

      let content = fs.readFileSync(envPath, 'utf-8');
      const regex = /^REFRESH_TOKEN=.*$/m;
      if (content.match(regex)) {
        content = content.replace(regex, `REFRESH_TOKEN=${newToken}`);
      } else {
        content += `\nREFRESH_TOKEN=${newToken}`;
      }
      fs.writeFileSync(envPath, content);
      logger.info('Updated REFRESH_TOKEN in .env');
    } catch (err) {
      // Non-fatal: token is still in memory for this run
      logger.warn('Could not persist rotated refresh token to .env', err);
    }
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
   * Day.ai returns: { native_type: { results: [...], totalCount: N }, hasMore, nextOffset }
   */
  private extractSearchResults(parsed: unknown, objectType: string): unknown[] {
    if (!parsed) return [];
    if (Array.isArray(parsed)) return parsed;

    const obj = parsed as Record<string, unknown>;

    // Primary format: { native_pipeline: { results: [...] } }
    if (obj[objectType] && typeof obj[objectType] === 'object') {
      const typed = obj[objectType] as Record<string, unknown>;
      if (Array.isArray(typed.results)) return typed.results;
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

  /**
   * Search for a contact by email using search_objects.
   * Only passes: queries (with objectType + where). No extra params.
   */
  async searchContactByEmail(email: string): Promise<DayContact | null> {
    const result = await this.mcpCallTool('search_objects', {
      queries: [{
        objectType: 'native_contact',
        where: {
          propertyId: 'email',
          operator: 'eq',
          value: email,
        },
      }],
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

  /**
   * Find all pipelines and match by name.
   * Only passes: queries (with objectType). No description/propertiesToReturn.
   */
  async findPipelineByName(name: string): Promise<DayPipeline | null> {
    const result = await this.mcpCallTool('search_objects', {
      queries: [{
        objectType: 'native_pipeline',
      }],
    });

    const parsed = this.parseResult(result);
    const pipelines = this.extractSearchResults(parsed, 'native_pipeline') as DayPipeline[];
    logger.debug(`Found ${pipelines.length} pipelines`, pipelines.map(p => ({ id: p.id, title: p.title })));
    return pipelines.find(
      (p) => p.title?.toLowerCase() === name.toLowerCase()
    ) || null;
  }

  /**
   * Find stages for a pipeline and match by name.
   * Uses where clause with propertyId/operator/value format (from SDK tests).
   */
  async findStageByName(pipelineId: string, stageName: string): Promise<DayStage | null> {
    const result = await this.mcpCallTool('search_objects', {
      queries: [{
        objectType: 'native_stage',
        where: {
          propertyId: 'pipelineId',
          operator: 'eq',
          value: pipelineId,
        },
      }],
    });

    const parsed = this.parseResult(result);
    const stages = this.extractSearchResults(parsed, 'native_stage') as DayStage[];
    logger.debug(`Found ${stages.length} stages`, stages.map(s => ({ id: s.id, title: s.title })));
    return stages.find(
      (s) => s.title?.toLowerCase() === stageName.toLowerCase()
    ) || null;
  }

  // ─── Opportunity (Deal) Operations ────────────────────────────────

  /**
   * Search for opportunities. Fetches all and filters client-side
   * since relationship-based where isn't supported.
   */
  async searchOpportunitiesByContact(email: string): Promise<DayOpportunity[]> {
    const result = await this.mcpCallTool('search_objects', {
      queries: [{
        objectType: 'native_opportunity',
      }],
    });

    const parsed = this.parseResult(result);
    const allOpps = this.extractSearchResults(parsed, 'native_opportunity') as DayOpportunity[];

    // Filter client-side: match by primaryPerson, roles, or title containing the email
    return allOpps.filter((opp) => {
      const primaryPerson = (opp as Record<string, unknown>).primaryPerson;
      if (primaryPerson === email) return true;

      // Check roles array for matching personEmail
      const roles = (opp as Record<string, unknown>).roles as Array<{ personEmail?: string }> | undefined;
      if (roles?.some(r => r.personEmail === email)) return true;

      // Check if the email domain matches the deal domain
      const domain = (opp as Record<string, unknown>).domain as string | undefined;
      const emailDomain = email.split('@')[1];
      if (domain && emailDomain && domain === emailDomain) return true;

      return false;
    });
  }

  async createOpportunity(params: {
    title: string;
    stageId: string;
    domain?: string;
    primaryPerson: string;
    description?: string;
    organizationName?: string;
    currentStatus?: string;
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
