export function parseJsonBody(rawBody) {
  return JSON.parse(rawBody.toString('utf8'));
}
