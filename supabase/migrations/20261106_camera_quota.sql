-- ==============================================================================
-- VYZN Netra - Camera Quota & Manual UPI Billing Migration
-- ==============================================================================

-- 1. Camera Quota Table
CREATE TABLE IF NOT EXISTS public.camera_quota (
    tenant_id TEXT PRIMARY KEY,
    purchased INT NOT NULL DEFAULT 0 CHECK (purchased >= 0),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Quota Orders Table
CREATE TABLE IF NOT EXISTS public.quota_orders (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    quantity INT NOT NULL CHECK (quantity > 0),
    unit_price_paise BIGINT NOT NULL,
    amount_paise BIGINT NOT NULL,
    order_code TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('awaiting_payment', 'submitted', 'paid', 'rejected', 'expired')),
    utr TEXT UNIQUE,
    submitted_at TIMESTAMPTZ,
    verified_by TEXT,
    verified_at TIMESTAMPTZ,
    reject_reason TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Partial unique index: at most ONE order in awaiting_payment or submitted per tenant
CREATE UNIQUE INDEX IF NOT EXISTS idx_quota_orders_active ON public.quota_orders (tenant_id)
WHERE status IN ('awaiting_payment', 'submitted');

CREATE INDEX IF NOT EXISTS idx_quota_orders_tenant ON public.quota_orders (tenant_id);
CREATE INDEX IF NOT EXISTS idx_quota_orders_status ON public.quota_orders (status);
CREATE INDEX IF NOT EXISTS idx_quota_orders_utr ON public.quota_orders (utr);

-- 3. Payment Audit Table
CREATE TABLE IF NOT EXISTS public.payment_audit (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES public.quota_orders(id) ON DELETE CASCADE,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    detail JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_audit_order ON public.payment_audit (order_id);

-- 4. Row Level Security (RLS)
ALTER TABLE public.camera_quota ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quota_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_audit ENABLE ROW LEVEL SECURITY;

-- Tenants read own quota
CREATE POLICY "Tenants read own quota"
    ON public.camera_quota
    FOR SELECT
    TO anon, authenticated
    USING (tenant_id = auth.uid()::text OR tenant_id = current_setting('request.jwt.claims', true)::json->>'sub');

-- Tenants read own orders
CREATE POLICY "Tenants read own orders"
    ON public.quota_orders
    FOR SELECT
    TO anon, authenticated
    USING (tenant_id = auth.uid()::text OR tenant_id = current_setting('request.jwt.claims', true)::json->>'sub');

-- Service role has full access for backend processing
CREATE POLICY "Service role full access camera_quota"
    ON public.camera_quota
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role full access quota_orders"
    ON public.quota_orders
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role full access payment_audit"
    ON public.payment_audit
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 5. Backfill Migration for existing tenants
-- For every existing tenant in vyzn_users, insert initial row with purchased = 1
-- (or current camera count) so nothing breaks when enforcement is enabled.
INSERT INTO public.camera_quota (tenant_id, purchased)
SELECT id, 1 FROM public.vyzn_users
ON CONFLICT (tenant_id) DO NOTHING;
