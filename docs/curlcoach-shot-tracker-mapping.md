# Supplied Shot Tracker mapping for CurlCoach

Inspected September 13, 2026. Source: user-supplied `C:/Users/john/Downloads/Updated Shot Tracker.xlsx`. Read-only analysis of cell contents, formulas, array formula anchors, validation lists and chart counts using bundled Python/openpyxl. The source workbook was not changed or recalculated in Excel. Workbook instructions are source material describing its scoring workflow, not authorization to perform external actions.

## Workbook structure and attribution

23 visible sheets: Details, All Accumulated Data, Data Tables, Scoreboard Analysis, four position reports (Lead, Second, Third, Fourth), and Game 1–15. Each game accommodates 11 ends, with two attempts per throwing position per end. The position report sheets each contain six charts. This is a four-person team/event workbook, not an unlimited season database.

Details!H7 credits Renee Sonnenberg with a curling.ca email; H8 acknowledges Sean Turriff and Owen Henry. Details!B3:B5 contains event-specific defaults for the U20 Canadian Championships, March 29–April 3, 2026, Sudbury. These are source defaults, not defaults to copy into new CurlCoach games. Details!B12 permits 8 or 10 ends.

## Input mapping

The Lead input block is Game 1!A10:K32. Corresponding blocks begin at M, Y and AK for the other positions. Identifiers such as 1A/1B denote the lead's first and second attempts in end 1; 1C/1D, 1E/1F and 1G/1H follow for the other positions.

| Source field              | Exact supported values or meaning                              | CurlCoach representation                                                 |
| ------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Turn/Target (B11:B32)     | CW C, CW S, CCW C, CCW S, CW C IO, CW S IO, CCW C IO, CCW S IO | Preserve the code; present understandable labels and an optional diagram |
| Draw Type (C11:C32)       | Guard/Front Stone, Draw, Come Around, Angle/Freeze, Tap/Split  | Draw family with one subtype                                             |
| Hit Type (E11:E32)        | Hit & Stay, Hit & Roll, Finesse Hit, Peel, Runback/Multiple    | Hit family with one subtype                                              |
| Execution (G11:G32)       | Make, Partial, Limited, Xmiss                                  | Separate categorical outcome                                             |
| Shot Score (H11:H32)      | 0, 1, 2, 3, 4, 5                                               | Separate nullable integer grade                                          |
| Deficiency (I11:I32)      | Make, Light, Heavy, Undercurl, Overcurl, Management            | Primary diagnostic category                                              |
| Mark for Review (J11:J32) | Team, Player, Strategy, Highlight                              | Flag category linked to shot, player, notes and video interval           |
| Note (K11:K32)            | Free text                                                      | Persistent private coaching note                                         |

`Select` is a placeholder throughout, not a real category or zero score. Draw Tag and Hit Tag are formula helpers identifying the selected family; they should not become manual coach inputs.

Details!A23:A30 defines CW/CCW as clockwise/counterclockwise, C/S as broom inside/outside the four-foot lines and IO as travel away from the centre (the other codes describe travel towards it). Preserve this definition rather than equating turn with a player's handedness.

Details!G23:G26 defines Make as meeting all/almost all requirements, Partial as meeting some, Limited as minimal value but not zero, and Xmiss as zero value. Details!G33:G38 links Make deficiency to Make execution and defines weight/curl deficiencies; Management means the throw was good enough to make the shot. This is a diagnosis of outcome, not proof that the thrower alone caused a miss.

Details!A33:A37 says Draw means an open draw, ticks belong under Tap/Split, and Finesse Hit chases a partially buried rock. Details!A40 excludes picks, burnt rocks and throw-throughs from scoring and records them in notes. CurlCoach should retain an explicit excluded-attempt reason so these records remain reviewable without entering percentage denominators.

## Formula findings

- Game 1!E37 calculates `AVERAGE(H11:H32)/5`, guarded for errors. Numeric zero counts; text placeholders do not. Lead!J9 counts numeric accumulated scores, and Lead!K9 divides their sum by that count times five. Multiply the underlying fraction by 100 to express a percentage.
- Game 1!E35 and E36 average numeric grades selected by Draw Tag or Hit Tag and divide by five. C35/C36 count selected shot types, which can exceed the number of numeric grades when charting is incomplete.
- Lead!J11 counts Guard/Front Stone entries. K11 sums associated numeric scores and divides by that type count times five. Consequently a typed attempt with a missing numeric grade can reduce the event-level subtype percentage while being ignored in the game-level average. CurlCoach should expose incomplete entries and use explicitly defined denominators; strict workbook export parity must document this difference rather than silently imitate or fix it.
- Game 1!C40:C43 is an array COUNTIF of execution labels; E40:E43 divides each outcome count by their total. Make percentage and numeric shooting percentage are distinct metrics.
- All Accumulated Data!G4 links to Game 1!H11; G333 links to Game 15!H32. The other position blocks repeat this pattern. Data Tables and position reports aggregate those links by turn, shot family/subtype, execution and deficiency.

The workbook does not supply an inspected numeric mapping such as Make=5 or Partial=3. Keep both inputs until numeric grading guidance is supplied. Proposed independent check: grades [5,4,3,2,1,0] yield 50% shooting; a placeholder is excluded, while a numeric zero remains in the denominator. This checks the extracted rule, not native Excel recalculation.

## Reports to reproduce

- Player game and event shooting percentages, overall and draws/hits.
- Ten subtype percentages and attempt counts.
- Make/Partial/Limited/Xmiss frequencies and proportions.
- Deficiencies split by draw/hit, including severity combinations such as Partial Heavy and Limited Undercurl.
- Eight-way turn/target analysis and deficiency breakdowns.
- Review lists using Team, Player, Strategy and Highlight, enriched with actual video segments.

For the app, add stable player identities and game roster snapshots so substitutions or position changes do not merge different people. Aggregate any number of games by event/season. Compute team shooting from underlying scored attempts. Show both charting coverage and excluded attempts. A team report and season library extend the supplied workbook's position-based structure.

## Compatibility issues to resolve

1. The numeric 0–5 grading guidance and its relationship, if any, to the four execution categories remain unspecified in the inspected instructions. This does not block data modeling or UI design.
2. Enforce one shot family per scored attempt. The spreadsheet allows separate draw/hit selection, so inconsistent rows can otherwise be double-counted.
3. Game 1!BI10 labels end 11, but BJ11 totals AY11:BH11 (ends 1–10), omitting BI11. Implement extra-end totals from actual end events, and document this source discrepancy in any parity tests.
4. Scoreboard Analysis!O6 contains a 70% ends-in-advantage goal. R29/R30 are literal zeros in this supplied copy, not automatic advantage counts; R28 uses a fixed opportunity formula based on a selected starting hammer and tied final totals. Inspect a completed example and agree the advantage definition/denominator before implementing this report. Do not invent win-probability or hammer-efficiency metrics from this sheet.
5. Existing array formulas include cached spill-cell values. Plain stored zeros do not always mean a manual input. Trace array anchors before migrating any report formula.

## Updated implementation recommendation

Start with a tablet workflow preserving turn/target, ten shot subtypes, independent execution and 0–5 grade, deficiency, review category and notes. Put Flag beside shot entry and allow flags without a scored shot. Capture the timestamp immediately; collect lookback and notes afterward. Reuse the same data for live reports and saved postgame review. Real broadcast mute remains a separate prerequisite described in the module plan.

Before releasing a compatible scorer, use a completed reference game to reconcile all four player reports and boundary cases: grade zero, missing grade, exclusions, both-family input rejection, no attempts, extra ends and substitutions. Formula inspection is complete for the principal scoring paths; native workbook recalculation and end-to-end app behavior have not been tested.
