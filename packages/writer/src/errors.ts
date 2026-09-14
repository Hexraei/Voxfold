/**
 * Every way a write can be refused.
 *
 * Each is a distinct, typed reason rather than a generic "write failed": the overlay and CLI show
 * a specific, honest message for each ("this file changed on disk since the page loaded"), and a
 * caller can tell a transient problem (StaleSource: re-map and retry) from a structural one
 * (OutOfBounds: this edit was never going to be safe).
 */

export type WriteErrorCode =
  | 'PathOutsideProject'
  | 'PathInDenylistedDir'
  | 'UnsupportedExtension'
  | 'FileTooLarge'
  | 'UntrackedFile'
  | 'StaleSource'
  | 'TargetMismatch'
  | 'OutOfBounds'
  | 'CollateralChange'
  | 'ReparseFailed'
  | 'UnexpectedChange'
  | 'RoundTripMismatch'
  | 'NoEdits'
  | 'OverlappingEdits'

export class WriteError extends Error {
  readonly code: WriteErrorCode

  constructor(code: WriteErrorCode, message: string) {
    super(message)
    this.name = 'WriteError'
    this.code = code
  }
}

export function isWriteError(value: unknown): value is WriteError {
  return value instanceof WriteError
}
