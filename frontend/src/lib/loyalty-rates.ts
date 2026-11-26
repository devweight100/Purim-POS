import {
  DEFAULT_SHOP_POINT_RATES,
  effectivePointRates,
  shopPointRates,
  type EffectivePointRates,
  type MemberPointFields,
  type ShopPointRates,
} from '@shared/loyalty';

/**
 * The shop-wide point rates (store_settings.loyalty_config) as this device last read them from the server, so the POS
 * shows the same points the server will give (shared/src/loyalty.ts). Mirrored in localStorage for an offline start.
 */
const KEY = 'purim-cache:loyalty-config';
let current: ShopPointRates | null = null;
let rawConfig: unknown = null;

export function setShopLoyaltyConfig(config: unknown) {
  rawConfig = config ?? {};
  current = shopPointRates(rawConfig);
  try {
    localStorage.setItem(KEY, JSON.stringify(rawConfig));
  } catch {
    /* storage unavailable */
  }
}

export function shopRates(): ShopPointRates {
  if (current) return current;
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (raw) {
      rawConfig = JSON.parse(raw);
      current = shopPointRates(rawConfig);
      return current;
    }
  } catch {
    /* fall through */
  }
  return DEFAULT_SHOP_POINT_RATES;
}

/** The rates that apply to a member (their own field when > 0, else the shop's). */
export function memberRates(member: MemberPointFields | null | undefined): EffectivePointRates {
  return effectivePointRates(member, shopRates());
}
