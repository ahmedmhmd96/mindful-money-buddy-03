
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS safety_buffer_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS include_income_day BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.recurring_items
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'mandatory' CHECK (priority IN ('mandatory','essential','optional'));

ALTER TABLE public.recurring_occurrences
  ADD COLUMN IF NOT EXISTS reflected_in_balance BOOLEAN NOT NULL DEFAULT false;
