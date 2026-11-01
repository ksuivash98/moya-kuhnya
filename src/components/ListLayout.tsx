import { useState } from "react";
import { Grid2X2, List } from "lucide-react";
import "./list-layout.css";
export type ListLayout = "grid" | "list";
function read(section: string): ListLayout {
  try {
    return localStorage.getItem(`kitchen-layout:${section}`) === "list"
      ? "list"
      : "grid";
  } catch {
    return "grid";
  }
}
export function useListLayout(
  section: string,
): [ListLayout, (value: ListLayout) => void] {
  const [stored, setStored] = useState(() => ({
    section,
    value: read(section),
  }));
  const value = stored.section === section ? stored.value : read(section);
  return [
    value,
    (next) => {
      setStored({ section, value: next });
      try {
        localStorage.setItem(`kitchen-layout:${section}`, next);
      } catch {
        /* Настройка доступна и без хранилища. */
      }
    },
  ];
}
export default function LayoutToggle({
  value,
  onChange,
  active = true,
}: {
  value: ListLayout;
  onChange: (value: ListLayout) => void;
  active?: boolean;
}) {
  return (
    <div className="list-layout-toggle" role="group" aria-label="Вид списка">
      <button
        type="button"
        aria-pressed={active && value === "grid"}
        onClick={() => onChange("grid")}
      >
        <Grid2X2 size={17} />
        Плитка
      </button>
      <button
        type="button"
        aria-pressed={active && value === "list"}
        onClick={() => onChange("list")}
      >
        <List size={17} />
        Строки
      </button>
    </div>
  );
}
