export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      categories: {
        Row: {
          color: string
          created_at: string
          id: string
          monthly_limit: number
          name: string
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          monthly_limit?: number
          name: string
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          monthly_limit?: number
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      goals: {
        Row: {
          active: boolean
          category_id: string | null
          created_at: string
          id: string
          kind: string
          target_amount: number
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          category_id?: string | null
          created_at?: string
          id?: string
          kind: string
          target_amount: number
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          category_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          target_amount?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goals_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_items: {
        Row: {
          active: boolean
          amount: number
          category_id: string | null
          created_at: string
          day_of_month: number | null
          day_of_week: number | null
          frequency: string
          id: string
          kind: string
          last_generated_on: string | null
          name: string
          template: string | null
          user_id: string
        }
        Insert: {
          active?: boolean
          amount: number
          category_id?: string | null
          created_at?: string
          day_of_month?: number | null
          day_of_week?: number | null
          frequency: string
          id?: string
          kind: string
          last_generated_on?: string | null
          name: string
          template?: string | null
          user_id: string
        }
        Update: {
          active?: boolean
          amount?: number
          category_id?: string | null
          created_at?: string
          day_of_month?: number | null
          day_of_week?: number | null
          frequency?: string
          id?: string
          kind?: string
          last_generated_on?: string | null
          name?: string
          template?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_occurrences: {
        Row: {
          actual_amount: number | null
          created_at: string
          due_date: string
          expected_amount: number
          id: string
          recurring_id: string
          status: string
          transaction_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          actual_amount?: number | null
          created_at?: string
          due_date: string
          expected_amount: number
          id?: string
          recurring_id: string
          status?: string
          transaction_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          actual_amount?: number | null
          created_at?: string
          due_date?: string
          expected_amount?: number
          id?: string
          recurring_id?: string
          status?: string
          transaction_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_occurrences_recurring_id_fkey"
            columns: ["recurring_id"]
            isOneToOne: false
            referencedRelation: "recurring_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_occurrences_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      scenario_items: {
        Row: {
          amount: number
          created_at: string
          duration_months: number | null
          id: string
          kind: string
          note: string | null
          one_off: boolean
          scenario_id: string
          start_date: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          duration_months?: number | null
          id?: string
          kind: string
          note?: string | null
          one_off?: boolean
          scenario_id: string
          start_date: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          duration_months?: number | null
          id?: string
          kind?: string
          note?: string | null
          one_off?: boolean
          scenario_id?: string
          start_date?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scenario_items_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "scenarios"
            referencedColumns: ["id"]
          },
        ]
      }
      scenarios: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          accuracy_type: string
          amount: number
          category_id: string | null
          created_at: string
          id: string
          kind: string
          note: string | null
          occurred_on: string
          period_end: string | null
          period_start: string | null
          source: string | null
          user_id: string
        }
        Insert: {
          accuracy_type?: string
          amount: number
          category_id?: string | null
          created_at?: string
          id?: string
          kind: string
          note?: string | null
          occurred_on?: string
          period_end?: string | null
          period_start?: string | null
          source?: string | null
          user_id: string
        }
        Update: {
          accuracy_type?: string
          amount?: number
          category_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          note?: string | null
          occurred_on?: string
          period_end?: string | null
          period_start?: string | null
          source?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      user_settings: {
        Row: {
          balance_updated_at: string | null
          current_balance: number | null
          cycle_end_day: number
          flex_spend_amount: number | null
          flex_spend_frequency: string | null
          next_income_amount: number | null
          next_income_date: string | null
          next_income_label: string | null
          onboarded_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          balance_updated_at?: string | null
          current_balance?: number | null
          cycle_end_day?: number
          flex_spend_amount?: number | null
          flex_spend_frequency?: string | null
          next_income_amount?: number | null
          next_income_date?: string | null
          next_income_label?: string | null
          onboarded_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          balance_updated_at?: string | null
          current_balance?: number | null
          cycle_end_day?: number
          flex_spend_amount?: number | null
          flex_spend_frequency?: string | null
          next_income_amount?: number | null
          next_income_date?: string | null
          next_income_label?: string | null
          onboarded_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
