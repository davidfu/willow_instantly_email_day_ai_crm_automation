import dotenv from 'dotenv';
dotenv.config();

export const config = {
  instantly: {
    apiKey: process.env.INSTANTLY_API_KEY || '',
    baseUrl: 'https://api.instantly.ai/api/v2',
    campaignName: process.env.INSTANTLY_CAMPAIGN_NAME || 'klaviyo cleaned sup, CAO list Dec 2025',
    sendingEmail: process.env.INSTANTLY_SENDING_EMAIL || 'fu@streetlightschools.org',
  },
  dayAi: {
    clientId: process.env.DAY_AI_CLIENT_ID || '',
    clientSecret: process.env.DAY_AI_CLIENT_SECRET || '',
    refreshToken: process.env.DAY_AI_REFRESH_TOKEN || '',
    baseUrl: process.env.DAY_AI_BASE_URL || 'https://day.ai',
    workspaceId: process.env.DAY_AI_WORKSPACE_ID || '',
    pipelineName: process.env.DAY_AI_PIPELINE_NAME || 'Sales Pipeline',
    stageName: process.env.DAY_AI_STAGE_NAME || 'Unqualified Lead',
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    webhookSecret: process.env.WEBHOOK_SECRET || '',
  },
  polling: {
    intervalMinutes: parseInt(process.env.POLL_INTERVAL_MINUTES || '5', 10),
  },
};

export function validateConfig(mode: 'webhook' | 'poll' | 'setup'): void {
  const missing: string[] = [];

  if (!config.instantly.apiKey) missing.push('INSTANTLY_API_KEY');

  if (mode !== 'setup') {
    if (!config.dayAi.clientId) missing.push('DAY_AI_CLIENT_ID');
    if (!config.dayAi.clientSecret) missing.push('DAY_AI_CLIENT_SECRET');
    if (!config.dayAi.refreshToken) missing.push('DAY_AI_REFRESH_TOKEN');
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      'Copy .env.example to .env and fill in the values.'
    );
  }
}
