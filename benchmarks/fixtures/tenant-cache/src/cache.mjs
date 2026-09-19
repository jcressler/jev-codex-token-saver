const prices = new Map();

export function readPrice(_tenantId, productId) {
  return prices.get(productId);
}

export function writePrice(_tenantId, productId, price) {
  prices.set(productId, price);
}

export function resetPrices() {
  prices.clear();
}
