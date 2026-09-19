import { createHmac, timingSafeEqual } from 'node:crypto';

export function expectedSignature(secret, body) {
  return createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
}

export function signatureMatches(secret, body, supplied) {
  const expected = Buffer.from(expectedSignature(secret, body), 'hex');
  const actual = Buffer.from(supplied, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
