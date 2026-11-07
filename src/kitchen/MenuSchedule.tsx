import { useState } from "react";

export type MenuScheduleValue = {
  period: boolean;
  date: string;
  month: string;
  start: string;
  end: string;
};

export default function MenuSchedule({
  initial,
  onPeriodChange,
}: {
  initial: MenuScheduleValue;
  onPeriodChange: (period: boolean) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div className="form-stack">
      <label>
        Добавить в меню
        <select
          aria-label="Добавить в меню"
          value={value.period ? "period" : "day"}
          onChange={(e) => {
            const period = e.target.value === "period";
            setValue({ ...value, period });
            onPeriodChange(period);
          }}
        >
          <option value="day">На один день / без даты</option>
          <option value="period">Общий список на несколько дней</option>
        </select>
      </label>
      {value.period ? (
        <>
          <label>
            Начало периода
            <input
              type="date"
              aria-label="Начало периода"
              value={value.start}
              required
              onChange={(e) => setValue({ ...value, start: e.target.value })}
            />
          </label>
          <label>
            Конец периода
            <input
              type="date"
              aria-label="Конец периода"
              value={value.end}
              required
              onChange={(e) => setValue({ ...value, end: e.target.value })}
            />
          </label>
        </>
      ) : (
        <>
          <label>
            Дата
            <input
              type="date"
              aria-label="Дата"
              value={value.date}
              onChange={(e) => setValue({ ...value, date: e.target.value })}
            />
          </label>
          <label>
            Месяц списка (первое число)
            <input
              type="date"
              aria-label="Месяц списка (первое число)"
              value={value.month}
              required
              onChange={(e) => setValue({ ...value, month: e.target.value })}
            />
          </label>
        </>
      )}
      <input type="hidden" name="menu_schedule" value={JSON.stringify(value)} />
    </div>
  );
}
