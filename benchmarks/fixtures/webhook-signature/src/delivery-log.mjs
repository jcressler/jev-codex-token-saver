export function deliveryLog(body, signature) {
  return { webhookId: body.id, signaturePrefix: signature.slice(0, 8) };
}
