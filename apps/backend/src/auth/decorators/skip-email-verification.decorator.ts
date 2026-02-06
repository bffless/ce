import { SetMetadata } from '@nestjs/common';

export const SKIP_EMAIL_VERIFICATION_KEY = 'skipEmailVerification';
export const SkipEmailVerification = () => SetMetadata(SKIP_EMAIL_VERIFICATION_KEY, true);
