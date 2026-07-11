CREATE TABLE public.user_settings (
  user_id UUID NOT NULL PRIMARY KEY,
  cycle_end_day INTEGER NOT NULL DEFAULT 31 CHECK (cycle_end_day BETWEEN 1 AND 31),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_settings TO authenticated;
GRANT ALL ON public.user_settings TO service_role;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own settings" ON public.user_settings FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);