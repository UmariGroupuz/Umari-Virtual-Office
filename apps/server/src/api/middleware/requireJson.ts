// JSON-only writes (API_CONTRACTS §0, ADR-027 §2): POST/PATCH must send `Content-Type: application/json`
// (a charset parameter is allowed), bodies are limited to 100 KB, an empty JSON body is `{}`.
import express, { type RequestHandler } from 'express';
import { LIMITS } from '@vo/shared';
import { appErrors } from '../../errors';

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

// `inflate: false`: compressed bodies (Content-Encoding gzip/deflate/br) are refused with 400 INVALID_JSON
// instead of being decompressed — no client compresses requests, and corrupt streams can never reach zlib
// (ADR-037, SEC-3).
const parseJson = express.json({
  limit: LIMITS.BODY_BYTES,
  type: 'application/json',
  strict: true,
  inflate: false,
});

export const requireJson: RequestHandler = (req, res, next) => {
  if (!WRITE_METHODS.has(req.method)) {
    next();
    return;
  }
  if (req.is('application/json') !== 'application/json') {
    next(appErrors.invalidJson('content-type'));
    return;
  }
  parseJson(req, res, (error?: unknown) => {
    if (error !== undefined && error !== null) {
      next(error);
      return;
    }
    const request = req as { body?: unknown };
    request.body ??= {};
    next();
  });
};
