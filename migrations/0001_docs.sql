-- The one table behind DocStore (src/core/storage/doc-store.ts): every value
-- DomBot persists, keyed by namespace + key, stored as JSON text. Values are
-- AES-GCM envelopes (see src/core/storage/encrypted.ts) — the operator's
-- root secret never touches this database, so its contents are ciphertext.
CREATE TABLE IF NOT EXISTS docs (
  ns TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (ns, key)
);
