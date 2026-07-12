import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { ExportProxyRuleSetResponseDto } from './export-proxy-rule-set.dto';

/**
 * Response DTOs for `GET /api/proxy-rule-sets/:id/revisions` and
 * `GET /api/proxy-rule-sets/:id/revisions/:revisionId`.
 *
 * Field names are the wire contract shared with the CLI's
 * `src/api/sync-types.ts` (`RevisionListItem`/`RevisionListResponse`/
 * `RevisionDetailResponse`) — keep them byte-identical.
 */

export class RevisionSourceDto {
  @ApiPropertyOptional({ description: 'Git repo the rule set was last synced from' })
  repo?: string;

  @ApiPropertyOptional({ description: 'Path within the repo the rule set was synced from' })
  path?: string;

  @ApiPropertyOptional({ description: 'Git commit SHA the rule set was last synced from' })
  gitSha?: string;

  @ApiProperty({ description: 'ISO timestamp of the last sync' })
  syncedAt: string;

  @ApiProperty({ description: 'Content hash stamped at the last sync' })
  contentHash: string;
}

export class RevisionListItemDto {
  @ApiProperty({ description: 'Revision id (uuid)' })
  id: string;

  @ApiProperty({ description: 'ISO timestamp the revision was captured' })
  createdAt: string;

  @ApiProperty({
    description: 'What triggered this capture',
    enum: ['sync', 'import', 'create', 'copy', 'set_update', 'rule_edit', 'rollback', 'backfill'],
  })
  trigger: string;

  @ApiProperty({ description: 'sha256 hex of the canonical snapshot envelope' })
  contentHash: string;

  @ApiProperty({ description: 'Number of rules in the snapshot' })
  ruleCount: number;

  @ApiProperty({
    description:
      "Whether this revision's contentHash matches the LIVE envelope's hash, computed per request",
  })
  current: boolean;

  @ApiPropertyOptional({
    type: RevisionSourceDto,
    nullable: true,
    description: 'Rules-as-code provenance carried over from the rule set at capture time, if any',
  })
  source?: RevisionSourceDto | null;
}

export class RevisionListResponseDto {
  @ApiProperty({ type: [RevisionListItemDto], description: 'Revisions, newest first' })
  revisions: RevisionListItemDto[];
}

export class RevisionDetailResponseDto extends RevisionListItemDto {
  @ApiProperty({ type: ExportProxyRuleSetResponseDto, description: 'Full v2 export envelope at capture time' })
  snapshot: ExportProxyRuleSetResponseDto;
}

/**
 * Request body for `POST /api/proxy-rule-sets/:id/rollback/:revisionId`. The
 * response is a `SyncProxyRuleSetResponseDto` — rollback replays the
 * revision's snapshot through `syncRuleSet` (see
 * `ProxyRuleSetsService.rollbackToRevision`).
 */
export class RollbackRuleSetDto {
  @ApiPropertyOptional({
    description: 'Compute and return the full rollback change plan without writing anything',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
