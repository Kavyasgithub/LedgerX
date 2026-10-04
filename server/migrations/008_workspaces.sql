-- Add workspace isolation to accounts and idempotency keys.
-- All other tables (postings, holds, transactions) derive their workspace
-- through their FK to accounts.

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS workspace_id TEXT NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS idx_accounts_workspace
  ON accounts(workspace_id);

-- Scope idempotency keys per workspace so two workspaces can reuse the same key.
ALTER TABLE idempotency_keys
  ADD COLUMN IF NOT EXISTS workspace_id TEXT NOT NULL DEFAULT 'default';
