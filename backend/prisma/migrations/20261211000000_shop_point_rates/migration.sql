-- Shop-wide point rates as the single source (docs/round-shift-today-bundle-replace.md section 5). Data only, additive.
--
-- 1. store_settings.loyalty_config gets explicit shop rates. Values already there (set on the customers page) are kept.
--    Missing ones start at what the system effectively used: 500 baht -> 10 points, 100 points -> 1 baht, unless the
--    old, otherwise unused columns points_per_baht / point_value were changed from their defaults (0.01 / 1): then
--    earn = 1 point per (1 / points_per_baht) baht and redeem = 1 point -> point_value baht.
-- 2. A member rate field equal to the shop rate is removed from customers.profile: those were copies the add-member
--    form put on every new member (and the frontend filled in for display). The effective rate does not change
--    (member field empty -> shop rate, the same value), and later changes of the shop rate now reach those members.
--    A member with a different value keeps it (that is their own rate).

CREATE FUNCTION pg_temp.rate_num(j jsonb) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN jsonb_typeof(j) = 'number' AND (j #>> '{}')::numeric > 0 THEN (j #>> '{}')::numeric
    WHEN jsonb_typeof(j) = 'string' AND btrim(j #>> '{}') ~ '^[0-9]+(\.[0-9]+)?$' AND btrim(j #>> '{}')::numeric > 0 THEN btrim(j #>> '{}')::numeric
    ELSE NULL END
$$;

UPDATE store_settings s SET loyalty_config = COALESCE(s.loyalty_config, '{}'::jsonb) || jsonb_build_object(
  'defaultPointEarnRateBaht', COALESCE(pg_temp.rate_num(s.loyalty_config -> 'defaultPointEarnRateBaht'),
    CASE WHEN s.points_per_baht > 0 AND s.points_per_baht <> 0.01 THEN round(1 / s.points_per_baht, 2) ELSE 500 END),
  'defaultPointEarnUnits', COALESCE(pg_temp.rate_num(s.loyalty_config -> 'defaultPointEarnUnits'),
    CASE WHEN s.points_per_baht > 0 AND s.points_per_baht <> 0.01 THEN 1 ELSE 10 END),
  'defaultPointRedeemRatePoints', COALESCE(pg_temp.rate_num(s.loyalty_config -> 'defaultPointRedeemRatePoints'),
    CASE WHEN s.point_value > 0 AND s.point_value <> 1 THEN 1 ELSE 100 END),
  'defaultPointRedeemDiscountBaht', COALESCE(pg_temp.rate_num(s.loyalty_config -> 'defaultPointRedeemDiscountBaht'),
    CASE WHEN s.point_value > 0 AND s.point_value <> 1 THEN s.point_value ELSE 1 END),
  'isLoyaltyEnabled', COALESCE(s.loyalty_config -> 'isLoyaltyEnabled', 'true'::jsonb),
  'minRedeemPoints', COALESCE(s.loyalty_config -> 'minRedeemPoints', '0'::jsonb)
);

WITH shop AS (
  SELECT
    COALESCE(pg_temp.rate_num(loyalty_config -> 'defaultPointEarnRateBaht'), 500) AS eb,
    COALESCE(pg_temp.rate_num(loyalty_config -> 'defaultPointEarnUnits'), 10) AS eu,
    COALESCE(pg_temp.rate_num(loyalty_config -> 'defaultPointRedeemRatePoints'), 100) AS rp,
    COALESCE(pg_temp.rate_num(loyalty_config -> 'defaultPointRedeemDiscountBaht'), 1) AS rb
  FROM store_settings ORDER BY id LIMIT 1
)
UPDATE customers c SET profile = c.profile
  - (CASE WHEN pg_temp.rate_num(c.profile -> 'pointEarnRateBaht') = shop.eb THEN 'pointEarnRateBaht' ELSE '' END)
  - (CASE WHEN pg_temp.rate_num(c.profile -> 'pointEarnUnits') = shop.eu THEN 'pointEarnUnits' ELSE '' END)
  - (CASE WHEN pg_temp.rate_num(c.profile -> 'pointRedeemRatePoints') = shop.rp THEN 'pointRedeemRatePoints' ELSE '' END)
  - (CASE WHEN pg_temp.rate_num(c.profile -> 'pointRedeemDiscountBaht') = shop.rb THEN 'pointRedeemDiscountBaht' ELSE '' END)
FROM shop
WHERE jsonb_typeof(c.profile) = 'object'
  AND (pg_temp.rate_num(c.profile -> 'pointEarnRateBaht') = shop.eb OR pg_temp.rate_num(c.profile -> 'pointEarnUnits') = shop.eu
    OR pg_temp.rate_num(c.profile -> 'pointRedeemRatePoints') = shop.rp OR pg_temp.rate_num(c.profile -> 'pointRedeemDiscountBaht') = shop.rb);
