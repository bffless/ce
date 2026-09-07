import { Module, forwardRef } from '@nestjs/common';
import { AppTokensController } from './app-tokens.controller';
import { AppTokensService } from './app-tokens.service';
import { ProjectsModule } from '../projects/projects.module';
import { PermissionsModule } from '../permissions/permissions.module';

@Module({
  // forwardRef: this file is first required *while* projects.module.ts is
  // still evaluating (app → setup → auth → settings → domains → projects →
  // pipelines → oauth → app-tokens), so a direct reference to ProjectsModule
  // is `undefined` at decoration time and Nest refuses to boot ("The module
  // at index [0] of the AppTokensModule imports array is undefined").
  // PermissionsModule is deferred the same way so a future re-ordering of
  // that chain cannot reintroduce the crash.
  imports: [forwardRef(() => ProjectsModule), forwardRef(() => PermissionsModule)],
  controllers: [AppTokensController],
  providers: [AppTokensService],
  exports: [AppTokensService],
})
export class AppTokensModule {}
