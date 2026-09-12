export function AccomplishmentYearSelect({ year }: { year?: number }) {
  const current = Number(
    new Intl.DateTimeFormat("en", {
      year: "numeric",
      timeZone: "America/Toronto",
    }).format(new Date()),
  );
  const newest = Math.max(current + 5, year ?? current);
  return (
    <label>
      Accomplishment year
      <select
        name="accomplishmentYear"
        defaultValue={year ?? current}
        className="mt-1 min-h-11 w-full rounded-lg bg-slate-800 p-3"
      >
        {Array.from(
          { length: newest - 1900 + 1 },
          (_, index) => newest - index,
        ).map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
    </label>
  );
}
