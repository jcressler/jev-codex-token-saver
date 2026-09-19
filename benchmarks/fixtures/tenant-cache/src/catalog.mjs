import { readPrice, writePrice } from './cache.mjs';

export async function catalogPrice(tenantId, productId, loadPrice) {
  const cached = readPrice(tenantId, productId);
  if (cached !== undefined) return cached;
  const price = await loadPrice(tenantId, productId);
  writePrice(tenantId, productId, price);
  return price;
}
