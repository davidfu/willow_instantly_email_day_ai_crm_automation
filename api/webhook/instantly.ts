import type { VercelRequest, VercelResponse } from '@vercel/node';
import { SyncEngine } from '../../src/sync/engine';
import { validateConfig } from '../../src/config';
import { logger } from '../../src/utils/logger';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    validateConfig();

    const payload = req.body;
    logger.info('Received webhook payload', { event_type: payload?.event_type, lead_email: payload?.lead_email });

    if (payload?.event_type !== 'email_opened') {
      logger.debug(`Ignoring non-open event: ${payload?.event_type}`);
      return res.status(200).json({ status: 'ignored', reason: 'not email_opened' });
    }

    const leadEmail = payload.lead_email;
    if (!leadEmail) {
      logger.warn('No lead_email in payload');
      return res.status(200).json({ status: 'ignored', reason: 'no lead_email' });
    }

    const engine = new SyncEngine();
    await engine.initialize();
    await engine.handleEmailOpened(leadEmail);

    return res.status(200).json({ status: 'processed', lead_email: leadEmail });
  } catch (err) {
    logger.error('Webhook processing error', err);
    // Return 200 to prevent Instantly retries
    return res.status(200).json({ status: 'error', message: String(err) });
  }
}
