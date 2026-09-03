import { HttpException, HttpStatus } from '@nestjs/common';

/** RFC 6749 §5.2 / §4.1.2.1, RFC 7591 §3.2.2, RFC 8707 §2: `{ error, error_description }`. */
export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'invalid_scope'
  | 'invalid_target'
  | 'invalid_client_metadata'
  | 'invalid_redirect_uri'
  | 'access_denied';

export class OAuthError extends HttpException {
  constructor(
    public readonly error: OAuthErrorCode,
    public readonly description: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super({ error, error_description: description }, status);
  }
}
