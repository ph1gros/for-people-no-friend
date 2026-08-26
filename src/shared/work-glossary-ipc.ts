import type { WorkGlossarySource } from '../core/conversation/work-glossary';

export interface WorkGlossaryInput {
  sourceWork: string;
}

export interface WorkGlossaryStatus {
  supported: boolean;
  workName?: string;
  entryCount: number;
  lastSynced?: number;
  sources: WorkGlossarySource[];
}

export type WorkGlossarySyncResult =
  { ok: true; status: WorkGlossaryStatus; message: string } | { ok: false; message: string };

export const parseWorkGlossaryInput = (value: unknown): WorkGlossaryInput => {
  if (typeof value !== 'object' || value === null || !('sourceWork' in value)) {
    throw new Error('The work glossary input is invalid.');
  }
  const sourceWork = value.sourceWork;
  if (typeof sourceWork !== 'string' || !sourceWork.trim() || sourceWork.length > 300) {
    throw new Error('The work glossary input is invalid.');
  }
  return { sourceWork: sourceWork.trim() };
};
