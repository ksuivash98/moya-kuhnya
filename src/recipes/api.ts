import { client, check } from "../supabase";
import {
  photoPaths,
  type Recipe,
  type RecipeData,
  type Ingredient,
  type Step,
} from "./model";
type RawRecipe = {
  id: string;
  family_id: string;
  title: string;
  description: string;
  category: string;
  cover_path: string;
  prep_minutes: number;
  cook_minutes: number;
  servings: number;
  difficulty: string;
  can_freeze: boolean;
  shelf_life: string;
  storage_conditions: string;
  thaw_instructions: string;
  notes: string;
  source_url: string;
  version: number;
  created_at: string;
  views: number;
  recipe_ingredients: {
    id: string;
    name: string;
    amount: number | null;
    unit: string;
    note: string;
    position: number;
  }[];
  recipe_steps: {
    id: string;
    description: string;
    photo_path: string;
    position: number;
  }[];
};
export async function loadRecipes(
  family: string,
  user: string,
): Promise<Recipe[]> {
  const data: RawRecipe[] = [];
  for (let offset = 0; ; offset += 200) {
    const { data: page, error } = await client().rpc("get_recipe_page", {
      p_family: family,
      p_offset: offset,
    });
    check(error);
    const rows = (page ?? []) as RawRecipe[];
    data.push(...rows);
    if (rows.length < 200) break;
  }
  const ids = new Set<string>();
  for (let offset = 0; ; offset += 200) {
    const { data: page, error } = await client()
      .from("recipe_favorites")
      .select("recipe_id")
      .eq("user_id", user)
      .order("recipe_id")
      .range(offset, offset + 199);
    check(error);
    for (const item of page ?? []) ids.add(item.recipe_id);
    if (!page || page.length < 200) break;
  }
  return [...new Map(data.map((r) => [r.id, r])).values()].map((r) => ({
    id: r.id,
    family_id: r.family_id,
    created_at: r.created_at,
    version: r.version,
    views: r.views,
    data: {
      title: r.title,
      description: r.description,
      category: r.category,
      photo: r.cover_path,
      prep: r.prep_minutes,
      cook: r.cook_minutes,
      servings: r.servings,
      difficulty: r.difficulty,
      freeze: r.can_freeze,
      shelfLife: r.shelf_life,
      storage: r.storage_conditions,
      thaw: r.thaw_instructions,
      notes: r.notes,
      source: r.source_url,
      favorite: ids.has(r.id),
      ingredients: r.recipe_ingredients
        .sort((a, b) => a.position - b.position)
        .map(
          (i): Ingredient => ({
            id: i.id,
            name: i.name,
            amount: i.amount === null ? "" : String(i.amount),
            unit: i.unit,
            note: i.note,
          }),
        ),
      steps: r.recipe_steps
        .sort((a, b) => a.position - b.position)
        .map(
          (s): Step => ({ id: s.id, text: s.description, photo: s.photo_path }),
        ),
    },
  }));
}
export async function setFavorite(id: string, value: boolean) {
  const { error } = await client().rpc("set_recipe_favorite", {
    p_recipe: id,
    p_value: value,
  });
  check(error);
}
export async function archiveRecipe(id: string, version: number) {
  const { error } = await client().rpc("archive_recipe", {
    p_recipe: id,
    p_version: version,
  });
  check(error);
}
export async function viewRecipe(id: string) {
  const { error } = await client().rpc("open_recipe", { p_recipe: id });
  check(error);
}
export async function signedPhoto(path: string) {
  const { data, error } = await client()
    .storage.from("recipe-photos")
    .createSignedUrl(path, 900);
  check(error);
  return data?.signedUrl ?? "";
}
export async function optimizePhoto(file: File): Promise<Blob> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error(
      "Выберите JPEG, PNG или WebP. Для HEIC сначала экспортируйте фото в JPEG.",
    );
  if (file.size > 20 * 1024 * 1024)
    throw new Error("Максимальный размер исходного фото — 20 МБ.");
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Браузер не смог обработать фотографию.");
  }
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob && blob.size <= 5 * 1024 * 1024
          ? resolve(blob)
          : reject(new Error("Не удалось сжать фото до 5 МБ.")),
      "image/jpeg",
      0.84,
    ),
  );
}
export async function saveRecipe(
  id: string,
  family: string,
  data: RecipeData,
  files: Map<string, Blob>,
  version: number | null,
  oldData?: RecipeData,
) {
  const next = structuredClone(data),
    uploaded: string[] = [];
  try {
    for (const [slot, blob] of files) {
      if (slot !== "cover" && !next.steps.some((s) => s.id === slot)) continue;
      const path = `${family}/${id}/${crypto.randomUUID()}.jpg`;
      const { error } = await client()
        .storage.from("recipe-photos")
        .upload(path, blob, { contentType: "image/jpeg", upsert: false });
      check(error);
      uploaded.push(path);
      if (slot === "cover") next.photo = path;
      else next.steps.find((s) => s.id === slot)!.photo = path;
    }
    const { data: result, error } = await client().rpc("save_recipe", {
      p_id: id,
      p_family: family,
      p_data: next,
      p_version: version,
    });
    check(error);
    const retained = new Set(photoPaths(next));
    const removed = oldData
      ? photoPaths(oldData).filter((p) => !retained.has(p))
      : [];
    let cleanupWarning = false;
    if (removed.length) {
      const { error: cleanupError } = await client()
        .storage.from("recipe-photos")
        .remove(removed);
      cleanupWarning = Boolean(cleanupError);
    }
    return { id: result as string, cleanupWarning };
  } catch (e) {
    if (uploaded.length) {
      try {
        await client().storage.from("recipe-photos").remove(uploaded);
      } catch {
        /* Привязанные после неоднозначного ответа файлы защищены Storage policy. */
      }
    }
    throw e;
  }
}
