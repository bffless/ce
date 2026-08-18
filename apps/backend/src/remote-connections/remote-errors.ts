/** Typed failures shared by the remote_request handler and (wrapped) the ffmpeg remote executor. */
export class RemoteBusyError extends Error {
  readonly code = 'REMOTE_BUSY';
}

export class RemoteUnavailableError extends Error {
  readonly code = 'REMOTE_UNAVAILABLE';

  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export class RemoteTimeoutError extends Error {
  readonly code = 'REMOTE_TIMEOUT';
}

export class RemoteResponseTooLargeError extends Error {
  readonly code = 'REMOTE_RESPONSE_TOO_LARGE';
}
