import { Module, forwardRef } from '@nestjs/common';
import { InvitationsController } from './invitations.controller.js';
import { InvitationsService } from './invitations.service.js';
import { SetupModule } from '../setup/setup.module.js';

@Module({
  imports: [forwardRef(() => SetupModule)],
  controllers: [InvitationsController],
  providers: [InvitationsService],
  exports: [InvitationsService],
})
export class InvitationsModule {}
