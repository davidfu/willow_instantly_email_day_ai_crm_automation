import dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import fetch from 'node-fetch';
import { logger } from '../utils/logger';

/**
 * Interactive OAuth setup wizard for Day.ai.
 *
 * Key behavior:
 * - If CLIENT_ID + CLIENT_SECRET already exist in .env, REUSE them (no re-registration).
 * - If REFRESH_TOKEN also exists, validate it. If valid, skip everything.
 * - Only registers a new OAuth client on first run (or if credentials are wiped).
 * - Only opens the browser auth flow if no valid refresh token exists.
 *
 * Run: npm run oauth:setup
 */

interface OAuthClientResponse {
  client_id: string;
  client_secret: string;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
}

const CALLBACK_PORT = 8080;
const CALLBACK_PATH = '/callback';
const REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}${CALLBACK_PATH}`;
const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

class OAuthSetup {
  private baseUrl: string;
  private integrationName: string;
  private redirectUri: string;

  constructor() {
    this.baseUrl = process.env.DAY_AI_BASE_URL || 'https://day.ai';
    this.integrationName = process.env.INTEGRATION_NAME || '';
    this.redirectUri = process.env.CALLBACK_URL || REDIRECT_URI;
  }

  async run(): Promise<void> {
    logger.info('=== Day.ai OAuth Setup ===\n');

    if (!this.integrationName || this.integrationName === 'My Day AI Integration') {
      logger.error(
        'Please set INTEGRATION_NAME in your .env file to something descriptive.\n' +
        'Example: INTEGRATION_NAME=Willow Instantly Integration'
      );
      process.exit(1);
    }

    // Check if we already have valid credentials
    const existingClientId = process.env.CLIENT_ID || '';
    const existingClientSecret = process.env.CLIENT_SECRET || '';
    const existingRefreshToken = process.env.REFRESH_TOKEN || '';

    // Step 1: Reuse existing client or register a new one
    let clientData: OAuthClientResponse;

    if (existingClientId && existingClientSecret) {
      logger.info(`Existing OAuth client found: ${existingClientId.substring(0, 8)}...`);
      logger.info('Reusing existing CLIENT_ID and CLIENT_SECRET (not re-registering).');
      clientData = { client_id: existingClientId, client_secret: existingClientSecret };

      // Step 1b: Check if refresh token is still valid
      if (existingRefreshToken) {
        logger.info('Checking if existing refresh token is still valid...');
        const isValid = await this.testRefreshToken(clientData, existingRefreshToken);
        if (isValid) {
          logger.info('\n=== Already authenticated ===');
          logger.info('Your existing credentials are valid. No action needed.');
          logger.info('If you need to force re-auth, clear REFRESH_TOKEN from .env and run again.');
          return;
        }
        logger.warn('Existing refresh token is expired or invalid. Re-authorizing...');
      }
    } else {
      // No existing client — register a new one
      logger.info(`Registering OAuth client: "${this.integrationName}"...`);
      clientData = await this.registerClient();
      logger.info(`Client registered. CLIENT_ID: ${clientData.client_id.substring(0, 8)}...`);
    }

    // Step 2: Generate auth URL
    const state = this.generateState();
    const authUrl = this.buildAuthUrl(clientData.client_id, state);
    logger.info('\n──────────────────────────────────────────');
    logger.info('Open this URL in your browser to authorize:');
    logger.info(authUrl);
    logger.info('──────────────────────────────────────────\n');

    // Step 3: Start local callback server and wait for auth code
    logger.info('Waiting for authorization (timeout: 5 minutes)...');
    const authCode = await this.waitForCallback(state);
    logger.info('Authorization code received.');

    // Step 4: Exchange code for tokens
    logger.info('Exchanging authorization code for tokens...');
    const tokens = await this.exchangeCodeForTokens(clientData, authCode);
    logger.info('Tokens received.');

    // Step 5: Write to .env
    this.updateEnvFile(clientData, tokens);
    logger.info('\n=== Setup complete ===');
    logger.info('CLIENT_ID, CLIENT_SECRET, and REFRESH_TOKEN have been written to .env');
    logger.info('You can now run: npm run setup (to discover pipeline/stage IDs)');
    logger.info('Then: npm start (webhook mode) or npm run poll (polling mode)');
  }

  /**
   * Test if a refresh token is still valid by attempting a token refresh.
   */
  private async testRefreshToken(
    clientData: OAuthClientResponse,
    refreshToken: string
  ): Promise<boolean> {
    try {
      const params = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientData.client_id,
        client_secret: clientData.client_secret,
        refresh_token: refreshToken,
      });

      const res = await fetch(`${this.baseUrl}/api/oauth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      if (res.ok) {
        const data = (await res.json()) as TokenResponse;
        // If Day.ai rotated the refresh token, save the new one
        if (data.refresh_token && data.refresh_token !== refreshToken) {
          logger.info('Day.ai issued a new refresh token — updating .env...');
          this.updateEnvFile(clientData, data);
        }
        return true;
      }

      logger.debug(`Refresh token test returned ${res.status}`);
      return false;
    } catch (err) {
      logger.debug('Refresh token test failed with error', err);
      return false;
    }
  }

  private async registerClient(): Promise<OAuthClientResponse> {
    const payload = {
      redirect_uris: [this.redirectUri],
      client_name: this.integrationName,
      client_uri: 'https://github.com/day-ai/day-ai-sdk',
      scope: 'assistant:*:use native_organization:write native_contact:write',
    };

    const res = await fetch(`${this.baseUrl}/api/oauth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to register OAuth client (${res.status}): ${text}`);
    }

    return res.json() as Promise<OAuthClientResponse>;
  }

  private buildAuthUrl(clientId: string, state: string): string {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: this.redirectUri,
      state,
      response_type: 'code',
    });
    return `${this.baseUrl}/integrations/authorize?${params.toString()}`;
  }

  private generateState(): string {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }

  private waitForCallback(expectedState: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        server.close();
        reject(new Error('Authorization timed out after 5 minutes'));
      }, TIMEOUT_MS);

      const server = http.createServer((req, res) => {
        const url = new URL(req.url || '', `http://127.0.0.1:${CALLBACK_PORT}`);

        if (url.pathname !== CALLBACK_PATH) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');

        if (state !== expectedState) {
          res.writeHead(400);
          res.end('State mismatch — possible CSRF attack. Please try again.');
          return;
        }

        if (!code) {
          const error = url.searchParams.get('error') || 'No authorization code received';
          res.writeHead(400);
          res.end(`Authorization failed: ${error}`);
          clearTimeout(timeout);
          server.close();
          reject(new Error(`Authorization failed: ${error}`));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html><body style="font-family: sans-serif; text-align: center; padding: 50px;">
            <h1>Authorization Successful</h1>
            <p>You can close this tab and return to the terminal.</p>
          </body></html>
        `);

        clearTimeout(timeout);
        server.close();
        resolve(code);
      });

      server.listen(CALLBACK_PORT, '127.0.0.1', () => {
        logger.debug(`Callback server listening on http://127.0.0.1:${CALLBACK_PORT}`);
      });
    });
  }

  private async exchangeCodeForTokens(
    clientData: OAuthClientResponse,
    code: string
  ): Promise<TokenResponse> {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
      client_id: clientData.client_id,
      client_secret: clientData.client_secret,
    });

    const res = await fetch(`${this.baseUrl}/api/oauth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Token exchange failed (${res.status}): ${text}`);
    }

    return res.json() as Promise<TokenResponse>;
  }

  private updateEnvFile(clientData: OAuthClientResponse, tokens: TokenResponse): void {
    const envPath = path.join(process.cwd(), '.env');
    let envContent = '';

    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf-8');
    }

    const updates: Record<string, string> = {
      CLIENT_ID: clientData.client_id,
      CLIENT_SECRET: clientData.client_secret,
      REFRESH_TOKEN: tokens.refresh_token,
    };

    let newContent = envContent;
    for (const [key, value] of Object.entries(updates)) {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (newContent.match(regex)) {
        newContent = newContent.replace(regex, `${key}=${value}`);
      } else {
        newContent += `\n${key}=${value}`;
      }
    }

    fs.writeFileSync(envPath, newContent.trim() + '\n');
    logger.info(`Credentials written to ${envPath}`);
  }
}

async function main() {
  const setup = new OAuthSetup();
  await setup.run();
}

main().catch((err) => {
  logger.error('OAuth setup failed', err);
  process.exit(1);
});
