ALTER TABLE accounts
    ADD COLUMN normal_side TEXT NOT NULL DEFAULT 'credit'
    CONSTRAINT chk_normal_side CHECK (normal_side IN ('debit', 'credit'));

-- Drop the default so the application must set it explicitly going forward.
ALTER TABLE accounts ALTER COLUMN normal_side DROP DEFAULT;
