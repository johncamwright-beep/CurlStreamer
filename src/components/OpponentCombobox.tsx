"use client";

import React, { useEffect, useRef, useState } from "react";

export type OpponentOption = { id: string; display_name: string };

const normalize = (text: string) =>
  text.trim().replace(/\s+/g, " ").toLocaleLowerCase();

export function filterOpponents(options: OpponentOption[], query: string) {
  const search = normalize(query);
  return search && search !== "tbd"
    ? options
        .filter((option) => normalize(option.display_name).includes(search))
        .slice(0, 8)
    : [];
}

export function OpponentCombobox({
  id,
  options,
  value,
  displayName,
  onSelect,
  disabled = false,
}: {
  id: string;
  options: OpponentOption[];
  value: string;
  displayName: string;
  onSelect: (id: string, displayName: string) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const committed = useRef({ id: value || "__tbd", name: displayName });
  const matches = query === null ? [] : filterOpponents(options, query);
  const expanded = open && matches.length > 0 && !disabled;
  const listId = `${id}-results`;

  useEffect(() => {
    if (value) {
      committed.current = { id: value, name: displayName };
      setQuery(null);
      setOpen(false);
      setActive(-1);
    }
  }, [value, displayName]);

  function choose(option: { id: string; name: string }) {
    committed.current = option;
    setQuery(null);
    setOpen(false);
    setActive(-1);
    onSelect(option.id, option.name);
  }

  return (
    <div className="relative min-w-0">
      <input
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={expanded}
        aria-activedescendant={
          expanded && active >= 0 ? `${listId}-${active}` : undefined
        }
        disabled={disabled}
        className="min-h-11 w-full"
        value={query ?? (value === "__tbd" ? "TBD" : displayName)}
        onFocus={(event) => {
          event.currentTarget.select();
          setOpen(query !== null);
        }}
        onBlur={() => {
          setOpen(false);
          setActive(-1);
        }}
        onChange={(event) => {
          const text = event.target.value;
          if (!normalize(text) || normalize(text) === "tbd") {
            choose({ id: "__tbd", name: "" });
            return;
          }
          setQuery(text);
          setOpen(true);
          setActive(-1);
          onSelect("", text);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            choose(committed.current);
          } else if (
            (event.key === "ArrowDown" || event.key === "ArrowUp") &&
            matches.length
          ) {
            event.preventDefault();
            setOpen(true);
            setActive((index) =>
              event.key === "ArrowDown"
                ? (index + 1) % matches.length
                : (index <= 0 ? matches.length : index) - 1,
            );
          } else if (event.key === "Enter" && query !== null) {
            event.preventDefault();
            if (expanded && active >= 0) {
              const option = matches[active];
              choose({ id: option.id, name: option.display_name });
            }
          }
        }}
      />
      {expanded && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching opponents"
          className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-slate-600 bg-slate-900 p-1 shadow-xl"
        >
          {matches.map((option, index) => (
            <li
              id={`${listId}-${index}`}
              key={option.id}
              role="option"
              aria-selected={active === index}
              className={`flex min-h-11 cursor-pointer items-center rounded px-3 py-2 ${active === index ? "bg-slate-700" : "hover:bg-slate-800"}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() =>
                choose({ id: option.id, name: option.display_name })
              }
            >
              {option.display_name}
            </li>
          ))}
        </ul>
      )}
      {query !== null && normalize(query) && !matches.length && (
        <p className="mt-1 text-sm text-slate-400" role="status">
          No matching opponents. Use Create New Opponent to add this team.
        </p>
      )}
    </div>
  );
}
