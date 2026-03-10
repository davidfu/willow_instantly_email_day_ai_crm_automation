export const config = {
  instantly: {
    apiKey: process.env.INSTANTLY_API_KEY || '',
    baseUrl: 'https://api.instantly.ai/api/v2',
    campaignId: process.env.INSTANTLY_CAMPAIGN_ID || '95e217bf-f7b0-4769-9ad9-b062f92b4caa',
    campaignName: process.env.INSTANTLY_CAMPAIGN_NAME || 'klaviyo cleaned sup, CAO list Dec 2025',
  },
  dayAi: {
    integrationName: process.env.INTEGRATION_NAME || 'Willow Instantly Integration',
    clientId: process.env.CLIENT_ID || '',
    clientSecret: process.env.CLIENT_SECRET || '',
    refreshToken: process.env.REFRESH_TOKEN || '',
    baseUrl: process.env.DAY_AI_BASE_URL || 'https://day.ai',
    pipelineId: process.env.DAY_AI_PIPELINE_ID || '67279be2-3e48-45b1-abfa-ae94a6fe198c',
    stageId: process.env.DAY_AI_STAGE_ID || 'fad7fcba-2b28-4bcd-979e-435779818487',
  },
};

export function validateConfig(): void {
  const missing: string[] = [];

  if (!config.instantly.apiKey) missing.push('INSTANTLY_API_KEY');
  if (!config.instantly.campaignId) missing.push('INSTANTLY_CAMPAIGN_ID');
  if (!config.dayAi.clientId) missing.push('CLIENT_ID');
  if (!config.dayAi.clientSecret) missing.push('CLIENT_SECRET');
  if (!config.dayAi.refreshToken) missing.push('REFRESH_TOKEN');
  if (!config.dayAi.pipelineId) missing.push('DAY_AI_PIPELINE_ID');
  if (!config.dayAi.stageId) missing.push('DAY_AI_STAGE_ID');

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`
    );
  }
}
