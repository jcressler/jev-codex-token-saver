import { parseJsonBody } from './body-parser.mjs';
import { signatureMatches } from './signature.mjs';

export function receiveWebhook(rawBody, signature, secret) {
  const body = parseJsonBody(rawBody);
  if (!signatureMatches(secret, body, signature)) throw new Error('invalid signature');
  return body;
}
