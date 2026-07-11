CREATE TABLE public.goals (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('savings','category_cap')),
  target_amount numeric NOT NULL CHECK (target_amount >= 0),
  category_id uuid REFERENCES public.categories(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.goals TO authenticated;
GRANT ALL ON public.goals TO service_role;

ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own goals" ON public.goals
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX goals_user_idx ON public.goals(user_id);