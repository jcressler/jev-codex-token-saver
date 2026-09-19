# Catalog cache policy

Catalog prices may differ between tenants because contracts and locations have
different price books. Cached entries therefore belong to both a tenant and a
product. A cache hit must never cross a tenant boundary.
