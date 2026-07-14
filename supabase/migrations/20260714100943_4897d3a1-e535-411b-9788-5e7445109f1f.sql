
-- user_settings additions
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS current_balance numeric,
  ADD COLUMN IF NOT EXISTS balance_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_income_amount numeric,
  ADD COLUMN IF NOT EXISTS next_income_date date,
  ADD COLUMN IF NOT EXISTS next_income_label text,
  ADD COLUMN IF NOT EXISTS flex_spend_amount numeric,
  ADD COLUMN IF NOT EXISTS flex_spend_frequency text CHECK (flex_spend_frequency IN ('daily','weekly','monthly')),
  ADD COLUMN IF NOT EXISTS onboarded_at timestamptz;

-- transactions additions
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS accuracy_type text NOT NULL DEFAULT 'exact'
    CHECK (accuracy_type IN ('exact','daily_total','category_total','balance_correction')),
  ADD COLUMN IF NOT EXISTS period_start date,
  ADD COLUMN IF NOT EXISTS period_end date;

-- recurring_items additions
ALTER TABLE public.recurring_items
  ADD COLUMN IF NOT EXISTS template text;

-- recurring_occurrences
CREATE TABLE IF NOT EXISTS public.recurring_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  recurring_id uuid NOT NULL REFERENCES public.recurring_items(id) ON DELETE CASCADE,
  due_date date NOT NULL,
  expected_amount numeric NOT NULL,
  actual_amount numeric,
  status text NOT NULL DEFAULT 'expected'
    CHECK (status IN ('expected','confirmed','delayed','skipped')),
  transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recurring_id, due_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recurring_occurrences TO authenticated;
GRANT ALL ON public.recurring_occurrences TO service_role;
ALTER TABLE public.recurring_occurrences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own occurrences" ON public.recurring_occurrences
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- scenarios
CREATE TABLE IF NOT EXISTS public.scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scenarios TO authenticated;
GRANT ALL ON public.scenarios TO service_role;
ALTER TABLE public.scenarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own scenarios" ON public.scenarios
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.scenario_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id uuid NOT NULL REFERENCES public.scenarios(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('income','expense')),
  amount numeric NOT NULL,
  one_off boolean NOT NULL DEFAULT true,
  start_date date NOT NULL,
  duration_months integer,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scenario_items TO authenticated;
GRANT ALL ON public.scenario_items TO service_role;
ALTER TABLE public.scenario_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own scenario items" ON public.scenario_items
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- updated_at trigger fn (safe re-create)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_recurring_occurrences_updated_at ON public.recurring_occurrences;
CREATE TRIGGER trg_recurring_occurrences_updated_at
  BEFORE UPDATE ON public.recurring_occurrences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_scenarios_updated_at ON public.scenarios;
CREATE TRIGGER trg_scenarios_updated_at
  BEFORE UPDATE ON public.scenarios
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
