export const reportLegend = [
  ["CW", "Clockwise stone rotation."],
  ["CCW", "Counterclockwise stone rotation."],
  ["C", "Broom target inside the four-foot lines."],
  ["S", "Broom target outside the four-foot lines."],
  [
    "IO / I-O",
    "In-out: travel away from centre. Without IO, travel is towards centre.",
  ],
  [
    "CCW-S",
    "Counterclockwise rotation, with the broom outside the four-foot lines. Also written CCW S.",
  ],
  [
    "W",
    "Not a separate charting code. Read CW or CCW together as the rotation direction.",
  ],
  [
    "Shooting %",
    "Grade points earned out of possible points (five per graded shot). This is not the percentage of fully made shots. The shot count shows the sample size.",
  ],
  [
    "Miss rate",
    "Partial, Limited and Miss outcomes out of all classified execution outcomes. Category shares use miss outcomes only.",
  ],
  [
    "Make / Partial / Limited / Miss",
    "Recorded execution outcomes. Miss is stored as Xmiss. Excluded shots do not count; an ungraded shot does not count in shooting %.",
  ],
  [
    "* / - / Not measured",
    "An asterisk marks a small sample. Not measured means no eligible observations, not zero performance.",
  ],
] as const;
