import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

const STATE_FILE = path.join(__dirname, '..', '..', 'data', 'processed-leads.json');

interface ProcessedEntry {
  email: string;
  lastOpenTimestamp: string;
  processedAt: string;
  dealCreated: boolean;
  dealId?: string;
}

interface StateData {
  processedLeads: Record<string, ProcessedEntry>;
  campaignId: string | null;
  pipelineId: string | null;
  stageId: string | null;
}

function loadState(): StateData {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf-8');
      return JSON.parse(raw) as StateData;
    }
  } catch (err) {
    logger.warn('Failed to load state file, starting fresh', err);
  }
  return {
    processedLeads: {},
    campaignId: null,
    pipelineId: null,
    stageId: null,
  };
}

function saveState(state: StateData): void {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export class StateStore {
  private state: StateData;

  constructor() {
    this.state = loadState();
  }

  isProcessed(email: string): boolean {
    return email in this.state.processedLeads;
  }

  getProcessedEntry(email: string): ProcessedEntry | null {
    return this.state.processedLeads[email] || null;
  }

  markProcessed(email: string, dealCreated: boolean, dealId?: string): void {
    this.state.processedLeads[email] = {
      email,
      lastOpenTimestamp: new Date().toISOString(),
      processedAt: new Date().toISOString(),
      dealCreated,
      dealId,
    };
    saveState(this.state);
  }

  get campaignId(): string | null {
    return this.state.campaignId;
  }

  set campaignId(id: string | null) {
    this.state.campaignId = id;
    saveState(this.state);
  }

  get pipelineId(): string | null {
    return this.state.pipelineId;
  }

  set pipelineId(id: string | null) {
    this.state.pipelineId = id;
    saveState(this.state);
  }

  get stageId(): string | null {
    return this.state.stageId;
  }

  set stageId(id: string | null) {
    this.state.stageId = id;
    saveState(this.state);
  }

  getProcessedCount(): number {
    return Object.keys(this.state.processedLeads).length;
  }
}
