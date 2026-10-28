import { useEffect, useState } from "react";
import { supabase } from "../supabase";
export function useRecipeCount(familyId: string, userId?: string) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    setCount(null);
    if (!supabase || !familyId || !userId) return;
    let active = true;
    const load = async () => {
      const { count, error } = await supabase!
        .from("recipes")
        .select("id", { count: "exact", head: true })
        .eq("family_id", familyId)
        .is("deleted_at", null);
      if (active) setCount(error ? null : count);
    };
    void load();
    const channel = supabase
      .channel(`recipe-count-${familyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "recipes",
          filter: `family_id=eq.${familyId}`,
        },
        () => void load(),
      )
      .subscribe();
    const refresh = () => void load();
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    const t = setInterval(refresh, 60000);
    return () => {
      active = false;
      void supabase?.removeChannel(channel);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      clearInterval(t);
    };
  }, [familyId, userId]);
  return [count, setCount] as const;
}
