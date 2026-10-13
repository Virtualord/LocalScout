import type { Db } from '../client.js';
import { AuditRepository } from './audits.repository.js';
import { ContactLogRepository } from './contact-log.repository.js';
import { DraftRepository } from './drafts.repository.js';
import { LeadRepository } from './leads.repository.js';
import { RunRepository } from './runs.repository.js';

export {
  AuditRepository,
  type AuditFindingRecord,
  type CreateAuditInput,
} from './audits.repository.js';
export {
  ContactLogRepository,
  computeMilestones,
  type AddContactLogInput,
  type Milestones,
} from './contact-log.repository.js';
export {
  DraftRepository,
  type CreateDraftInput,
  type GroundingStats,
} from './drafts.repository.js';
export {
  LeadRepository,
  type CreateLeadInput,
  type LeadFilters,
  type LeadWithScore,
} from './leads.repository.js';
export { RunRepository, type CreateRunInput, type RunCounters } from './runs.repository.js';

/**
 * Every repository, sharing one connection.
 *
 * Bundling them keeps the workflow shell from wiring five separate objects
 * while still letting a test construct just the one it needs.
 */
export interface Repositories {
  leads: LeadRepository;
  audits: AuditRepository;
  drafts: DraftRepository;
  contactLog: ContactLogRepository;
  runs: RunRepository;
}

export function createRepositories(handle: Db): Repositories {
  return {
    leads: new LeadRepository(handle),
    audits: new AuditRepository(handle),
    drafts: new DraftRepository(handle),
    contactLog: new ContactLogRepository(handle),
    runs: new RunRepository(handle),
  };
}
