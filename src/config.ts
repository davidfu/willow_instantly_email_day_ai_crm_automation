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
    integrationName: process.env.INTEGRATION_NAME || 'Willow Instantly Integration',
    clientId: process.env.CLIENT_ID || '',
    clientSecret: process.env.CLIENT_SECRET || '',
    refreshToken: process.env.REFRESH_TOKEN || '',
    baseUrl: process.env.DAY_AI_BASE_URL || 'https://day.ai',
    workspaceId: process.env.WORKSPACE_ID || '',
    pipelineName: process.env.DAY_AI_PIPELINE_NAME || 'Sales Pipeline',
    pipelineId: process.env.DAY_AI_PIPELINE_ID || '67279be2-3e48-45b1-abfa-ae94a6fe198c',
    stageName: process.env.DAY_AI_STAGE_NAME || 'Unqualified Lead',
    stageId: process.env.DAY_AI_STAGE_ID || 'fad7fcba-2b28-4bcd-979e-435779818487',
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    webhookSecret: process.env.WEBHOOK_SECRET || '',
  },
  polling: {
    intervalMinutes: parseInt(process.env.POLL_INTERVAL_MINUTES || '5', 10),
  },
};

export function validateConfig(mode: 'webhook' | 'poll' | 'setup' | 'oauth'): void {
  const missing: string[] = [];

  if (mode !== 'oauth') {
    if (!config.instantly.apiKey) missing.push('INSTANTLY_API_KEY');
  }

  if (mode === 'webhook' || mode === 'poll') {
    if (!config.dayAi.clientId) missing.push('CLIENT_ID');
    if (!config.dayAi.clientSecret) missing.push('CLIENT_SECRET');
    if (!config.dayAi.refreshToken) missing.push('REFRESH_TOKEN');
  }

  if (missing.length > 0) {
    const hint = missing.includes('CLIENT_ID')
      ? 'Run "npm run oauth:setup" to auto-populate Day.ai credentials.'
      : 'Copy .env.example to .env and fill in the values.';
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n${hint}`
    );
  }
}
