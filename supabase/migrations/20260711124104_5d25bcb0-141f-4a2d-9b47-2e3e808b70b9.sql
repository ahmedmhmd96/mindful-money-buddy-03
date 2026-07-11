
-- categories
CREATE TABLE public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name TEXT NOT NULL,
  monthly_limit NUMERIC(12,2) NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#64748b',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT ALL ON public.categories TO service_role;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own categories" ON public.categories FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- transactions
CREATE TABLE public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('expense','income')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  category_id UUID REFERENCES public.categories ON DELETE SET NULL,
  note TEXT,
  occurred_on DATE NOT NULL DEFAULT CURRENT_DATE,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transactions TO authenticated;
GRANT ALL ON public.transactions TO service_role;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own transactions" ON public.transactions FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX transactions_user_date_idx ON public.transactions(user_id, occurred_on DESC);

-- recurring_items
CREATE TABLE public.recurring_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('expense','income')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  category_id UUID REFERENCES public.categories ON DELETE SET NULL,
  name TEXT NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('monthly','weekly')),
  day_of_month INT CHECK (day_of_month BETWEEN 1 AND 31),
  day_of_week INT CHECK (day_of_week BETWEEN 0 AND 6),
  last_generated_on DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recurring_items TO authenticated;
GRANT ALL ON public.recurring_items TO service_role;
ALTER TABLE public.recurring_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own recurring" ON public.recurring_items FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
