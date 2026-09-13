-- Commit this enum addition before applying 0052/0053.
alter type public.team_membership_role add value if not exists 'game_operator';
