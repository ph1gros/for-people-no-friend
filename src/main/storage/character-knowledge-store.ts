import {
  CHARACTER_KNOWLEDGE_SCHEMA_VERSION,
  validateCharacterKnowledgeBase,
  validateCharacterKnowledgeNamespace,
  type CharacterKnowledgeBase,
  type CharacterKnowledgeEvidence,
  type CharacterKnowledgeKind,
  type CharacterKnowledgeRecord,
} from '../../core/character/character-knowledge';
import type { CharacterLoreSource } from '../../core/character/character-lore';
import { DeskpetDatabase } from './deskpet-database';

interface KnowledgeSourceRow {
  id: string;
  title: string;
  url: string;
  site_name: string;
  retrieved_at: number;
}

interface KnowledgeMetadataRow {
  source_work: string;
  profile_revision: string;
}

interface KnowledgeRecordRow {
  id: string;
  kind: CharacterKnowledgeKind;
  title: string;
  content: string;
  keywords_json: string;
  importance: number;
}

interface KnowledgeEvidenceRow {
  record_id: string;
  source_id: string;
  field_path: string;
  basis: CharacterKnowledgeEvidence['basis'];
}

const parseKeywords = (value: string): string[] | undefined => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
};

export class CharacterKnowledgeStore {
  public constructor(private readonly database: DeskpetDatabase) {}

  public get(characterNamespace: string): CharacterKnowledgeBase | undefined {
    const namespace = validateCharacterKnowledgeNamespace(characterNamespace);
    const metadata = this.database.connection
      .prepare(
        `SELECT source_work, profile_revision FROM character_knowledge_namespaces
          WHERE character_namespace = ?`,
      )
      .get(namespace) as KnowledgeMetadataRow | undefined;
    if (!metadata) return undefined;
    const sources = this.database.connection
      .prepare(
        `SELECT id, title, url, site_name, retrieved_at
           FROM character_knowledge_sources
          WHERE character_namespace = ?
          ORDER BY id`,
      )
      .all(namespace) as unknown as KnowledgeSourceRow[];
    const recordRows = this.database.connection
      .prepare(
        `SELECT id, kind, title, content, keywords_json, importance
           FROM character_knowledge_records
          WHERE character_namespace = ?
          ORDER BY id`,
      )
      .all(namespace) as unknown as KnowledgeRecordRow[];
    const evidenceRows = this.database.connection
      .prepare(
        `SELECT record_id, source_id, field_path, basis
           FROM character_knowledge_evidence
          WHERE character_namespace = ?
          ORDER BY record_id, source_id, field_path`,
      )
      .all(namespace) as unknown as KnowledgeEvidenceRow[];
    const evidenceByRecord = new Map<string, CharacterKnowledgeEvidence[]>();
    for (const row of evidenceRows) {
      evidenceByRecord.set(row.record_id, [
        ...(evidenceByRecord.get(row.record_id) ?? []),
        { sourceId: row.source_id, fieldPath: row.field_path, basis: row.basis },
      ]);
    }
    const records: CharacterKnowledgeRecord[] = [];
    for (const row of recordRows) {
      const keywords = parseKeywords(row.keywords_json);
      if (!keywords) return undefined;
      records.push({
        schemaVersion: CHARACTER_KNOWLEDGE_SCHEMA_VERSION,
        id: row.id,
        characterNamespace: namespace,
        kind: row.kind,
        title: row.title,
        content: row.content,
        keywords,
        importance: row.importance,
        evidence: evidenceByRecord.get(row.id) ?? [],
      });
    }
    const raw: CharacterKnowledgeBase = {
      schemaVersion: CHARACTER_KNOWLEDGE_SCHEMA_VERSION,
      characterNamespace: namespace,
      profileRevision: metadata.profile_revision,
      sourceWork: metadata.source_work,
      sources: sources.map((row): CharacterLoreSource => ({
        id: row.id,
        title: row.title,
        url: row.url,
        siteName: row.site_name,
        retrievedAt: row.retrieved_at,
      })),
      records,
    };
    try {
      return validateCharacterKnowledgeBase(raw);
    } catch {
      return undefined;
    }
  }

  public replace(value: CharacterKnowledgeBase): void {
    const base = validateCharacterKnowledgeBase(value);
    const namespace = base.characterNamespace;
    this.database.connection.exec('BEGIN IMMEDIATE');
    try {
      this.deleteNamespace(namespace);
      this.database.connection
        .prepare(
          `INSERT INTO character_knowledge_namespaces (
            character_namespace, schema_version, profile_revision, source_work, updated_at
          ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(namespace, base.schemaVersion, base.profileRevision, base.sourceWork, Date.now());
      const insertSource = this.database.connection.prepare(
        `INSERT INTO character_knowledge_sources (
          character_namespace, id, title, url, site_name, retrieved_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const source of base.sources) {
        insertSource.run(
          namespace,
          source.id,
          source.title,
          source.url,
          source.siteName,
          source.retrievedAt,
        );
      }
      const insertRecord = this.database.connection.prepare(
        `INSERT INTO character_knowledge_records (
          character_namespace, id, schema_version, kind, title, content,
          keywords_json, importance
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertEvidence = this.database.connection.prepare(
        `INSERT INTO character_knowledge_evidence (
          character_namespace, record_id, source_id, field_path, basis
        ) VALUES (?, ?, ?, ?, ?)`,
      );
      for (const record of base.records) {
        insertRecord.run(
          namespace,
          record.id,
          record.schemaVersion,
          record.kind,
          record.title,
          record.content,
          JSON.stringify(record.keywords),
          record.importance,
        );
        for (const evidence of record.evidence) {
          insertEvidence.run(
            namespace,
            record.id,
            evidence.sourceId,
            evidence.fieldPath,
            evidence.basis,
          );
        }
      }
      this.database.connection.exec('COMMIT');
    } catch (error) {
      this.database.connection.exec('ROLLBACK');
      throw error;
    }
  }

  public clear(characterNamespace: string): number {
    const namespace = validateCharacterKnowledgeNamespace(characterNamespace);
    this.database.connection.exec('BEGIN IMMEDIATE');
    try {
      const count = this.database.connection
        .prepare(
          `SELECT COUNT(*) AS count FROM character_knowledge_records
            WHERE character_namespace = ?`,
        )
        .get(namespace) as { count: number };
      this.deleteNamespace(namespace);
      this.database.connection.exec('COMMIT');
      return count.count;
    } catch (error) {
      this.database.connection.exec('ROLLBACK');
      throw error;
    }
  }

  private deleteNamespace(characterNamespace: string): void {
    this.database.connection
      .prepare('DELETE FROM character_knowledge_namespaces WHERE character_namespace = ?')
      .run(characterNamespace);
  }
}
