-- General US commercial dates for 2028 (same list as 2027). Add the next year the same way each fall.
INSERT INTO "CommercialDate" ("id", "name", "date", "country", "niches", "tip") VALUES
  (gen_random_uuid(), 'New Year''s Day', DATE '2028-01-01', 'US', ARRAY[]::text[], 'Good for fresh starts and what''s coming this year'),
  (gen_random_uuid(), 'Valentine''s Day', DATE '2028-02-14', 'US', ARRAY[]::text[], 'Good for couples, gifts and special menus'),
  (gen_random_uuid(), 'St. Patrick''s Day', DATE '2028-03-17', 'US', ARRAY[]::text[], 'Good for themed specials and green touches'),
  (gen_random_uuid(), 'Easter', DATE '2028-04-16', 'US', ARRAY[]::text[], 'Good for family gatherings and spring menus'),
  (gen_random_uuid(), 'Mother''s Day', DATE '2028-05-14', 'US', ARRAY[]::text[], 'Good for gifts, brunch and thank-you posts'),
  (gen_random_uuid(), 'Memorial Day', DATE '2028-05-29', 'US', ARRAY[]::text[], 'Good for cookouts and the start of summer'),
  (gen_random_uuid(), 'Father''s Day', DATE '2028-06-18', 'US', ARRAY[]::text[], 'Good for gifts and family meals'),
  (gen_random_uuid(), 'Independence Day', DATE '2028-07-04', 'US', ARRAY[]::text[], 'Good for cookouts, parties and big orders'),
  (gen_random_uuid(), 'Labor Day', DATE '2028-09-04', 'US', ARRAY[]::text[], 'Good for end-of-summer gatherings'),
  (gen_random_uuid(), 'Halloween', DATE '2028-10-31', 'US', ARRAY[]::text[], 'Good for themed treats and costumes'),
  (gen_random_uuid(), 'Thanksgiving', DATE '2028-11-23', 'US', ARRAY[]::text[], 'Good for gratitude posts and holiday orders'),
  (gen_random_uuid(), 'Black Friday', DATE '2028-11-24', 'US', ARRAY[]::text[], 'Best for offers and pre-orders'),
  (gen_random_uuid(), 'Small Business Saturday', DATE '2028-11-25', 'US', ARRAY[]::text[], 'Good for local pride and your regulars'),
  (gen_random_uuid(), 'Cyber Monday', DATE '2028-11-27', 'US', ARRAY[]::text[], 'Good for gift cards and pre-orders'),
  (gen_random_uuid(), 'Giving Tuesday', DATE '2028-11-28', 'US', ARRAY[]::text[], 'Good for community and causes you support'),
  (gen_random_uuid(), 'Christmas', DATE '2028-12-25', 'US', ARRAY[]::text[], 'Good for holiday menus, gifts and last-minute orders'),
  (gen_random_uuid(), 'New Year''s Eve', DATE '2028-12-31', 'US', ARRAY[]::text[], 'Good for parties, celebrations and year recaps')
ON CONFLICT ("name", "date") DO NOTHING;
