import { Injectable } from '@nestjs/common';
import { PipelineSchemasService } from './pipeline-schemas.service';
import {
  DeclaredField,
  collectUploadStepRefs,
  describeUploadSchemaGap,
  diffUploadSchema,
} from './upload-schema-contract';

/** What a schema looks like to the lint — a name to report and fields to check. */
export interface LintableSchema {
  name: string;
  fields: DeclaredField[];
}

/**
 * Advisory check run where upload pipelines are authored: does the schema a
 * step writes into actually declare what upload handlers write?
 *
 * Nothing here blocks a save. A mismatch is not a broken pipeline — files still
 * upload and the record is still written correctly — it just means the schema
 * describes something its own data isn't, and the fields it omits are invisible
 * to search and to the Uploads tab. Authors (and agents, via MCP tool output)
 * get told at the moment they can cheaply fix it.
 */
@Injectable()
export class UploadSchemaLintService {
  constructor(private readonly schemasService: PipelineSchemasService) {}

  /**
   * Lint a saved pipeline config, resolving each referenced schema from the DB.
   * Used by the rule create/update paths, where schema ids are real.
   */
  async lintPipelineConfig(pipelineConfig: unknown): Promise<string[]> {
    const refs = collectUploadStepRefs(pipelineConfig);
    if (refs.length === 0) return [];

    const resolved = new Map<string, LintableSchema | undefined>();
    for (const ref of refs) {
      if (resolved.has(ref.schemaId)) continue;
      const schema = await this.schemasService.getById(ref.schemaId);
      resolved.set(ref.schemaId, schema ? { name: schema.name, fields: schema.fields } : undefined);
    }

    return this.lintWithFields(pipelineConfig, (schemaId) => resolved.get(schemaId));
  }

  /**
   * Lint against schemas the caller already knows. The rules-as-code sync path
   * needs this: a bundled schema may not exist yet (and under `dryRun` never
   * will), but its fields are right there in the payload.
   */
  lintWithFields(
    pipelineConfig: unknown,
    resolve: (schemaId: string) => LintableSchema | undefined,
  ): string[] {
    const warnings: string[] = [];
    const reported = new Set<string>();

    for (const ref of collectUploadStepRefs(pipelineConfig)) {
      if (reported.has(ref.schemaId)) continue;

      // An unresolvable schema is not this lint's business — the handler raises
      // SchemaNotFoundError at run time, and duplicating it here as a warning
      // would just add noise to a save that already has a real error path.
      const schema = resolve(ref.schemaId);
      if (!schema) continue;

      const message = describeUploadSchemaGap(
        schema.name,
        diffUploadSchema(schema.fields, ref.extraFieldNames),
      );
      if (message) {
        reported.add(ref.schemaId);
        warnings.push(message);
      }
    }

    return warnings;
  }
}
