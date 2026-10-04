-- The reference column was unique globally.
-- Now that accounts are scoped per workspace, uniqueness must be
-- (reference, workspace_id) — the same reference can exist in different workspaces.

ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_reference_key;

ALTER TABLE accounts
  ADD CONSTRAINT accounts_reference_workspace_key UNIQUE (reference, workspace_id);
