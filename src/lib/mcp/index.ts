import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listTransactions from "./tools/list-transactions";
import addTransaction from "./tools/add-transaction";
import updateTransaction from "./tools/update-transaction";
import deleteTransaction from "./tools/delete-transaction";
import listCategories from "./tools/list-categories";
import listRecurring from "./tools/list-recurring";
import createRecurring from "./tools/create-recurring";
import confirmCommitment from "./tools/confirm-commitment";
import listGoals from "./tools/list-goals";
import createGoal from "./tools/create-goal";
import getSafeToSpend from "./tools/get-safe-to-spend";

// The OAuth issuer MUST be the direct Supabase host (RFC 8414 issuer must match discovery).
// VITE_SUPABASE_PROJECT_ID is inlined by Vite at build time; the fallback keeps the issuer
// well-formed during the throwaway manifest-extract eval and never verifies a real token.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "mindful-money-buddy-mcp",
  title: "Mindful Money Buddy",
  version: "0.1.0",
  instructions:
    "Read and update the signed-in user's personal budget in Egyptian Pounds (EGP). Use these tools to check current transactions, recurring commitments, budget categories, and savings goals, or to log new income/expenses on the user's behalf. All calls are scoped to the authenticated user via row-level security.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    getSafeToSpend,
    listTransactions,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    listCategories,
    listRecurring,
    createRecurring,
    confirmCommitment,
    listGoals,
    createGoal,
  ],
});
