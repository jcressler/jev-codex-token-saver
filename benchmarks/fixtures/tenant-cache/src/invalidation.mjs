export function invalidationTopic(tenantId, productId) {
  return `catalog:${tenantId}:${productId}:invalidate`;
}
