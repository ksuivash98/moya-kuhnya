import { client, check } from "../supabase";
import { type State, type Row } from "./model";
export async function loadKitchen(
  family: string,
  from: string,
  to: string,
): Promise<State> {
  let result: State = { schema_version: 4 };
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await client().rpc("get_kitchen_state", {
      p_family: family,
      p_from: from,
      p_to: to,
      p_offset: offset,
    });
    check(error);
    const page = data as State;
    let more = false;
    for (const [key, value] of Object.entries(page)) {
      if (Array.isArray(value)) {
        result[key] = [...((result[key] ?? []) as Row[]), ...value];
        if (value.length === 200) more = true;
      } else result[key] = value;
    }
    if (!more) break;
  }
  return result;
}
export async function mutate(
  family: string,
  action: string,
  data: Record<string, unknown>,
  key: string,
) {
  const { data: result, error } = await client().rpc("kitchen_mutate", {
    p_family: family,
    p_key: key,
    p_action: action,
    p_data: data,
  });
  check(error);
  return result as { id?: string };
}
