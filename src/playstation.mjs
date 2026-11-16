const storeUrl = "https://store.playstation.com/uk-ua";
const searchApi = "https://web.np.playstation.com/api/graphql/v1/op";
// The persisted search used by the public PlayStation Store storefront.
const searchHash = "4df6284f982e57bec70f23c77e2c219dc792eb19af7fb3d3a81767aa3f1958aa";
const gameTypes = new Set(["FULL_GAME", "GAME_BUNDLE", "PREMIUM_EDITION", "STANDARD_EDITION"]);
const productPattern = /^[A-Z0-9]{6}-[A-Z0-9]{9}_[A-Z0-9]{2}-[A-Z0-9]{16}$/;
const conceptPattern = /^[0-9]{1,16}$/;
const platformSuffix = /(?:\s+(?:для|for))?\s+(ps[45])(?:\s+(?:(?:та|і|and)\s+)?(ps[45]))?$/u;

export function listingFromKey(key) {
  if (typeof key !== "string") return null;
  const [kind, id, extra] = key.split(":");
  if (extra !== undefined || !id) return null;
  if (kind === "p" && productPattern.test(id)) return { kind, id, url: storeUrl + "/product/" + id };
  if (kind === "c" && conceptPattern.test(id)) return { kind, id, url: storeUrl + "/concept/" + id };
  return null;
}

export function searchPage(query) {
  return storeUrl + "/search/" + encodeURIComponent(query);
}

function titleParts(title) {
  const normalized = title.replace(/[™®©’']/gu, "")
    .normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim()
    .replace(/\bplaystation\s*([45])\b/g, "ps$1");
  const match = platformSuffix.exec(normalized);
  if (!match) return { title: normalized, platforms: [] };
  return { title: normalized.slice(0, match.index), platforms: match.slice(1).filter(Boolean).map(p => p.toUpperCase()) };
}

export async function searchStore(query) {
  const url = new URL(searchApi);
  url.search = new URLSearchParams({
    operationName: "getSearchResults",
    variables: JSON.stringify({
      countryCode: "UA", languageCode: "uk", nextCursor: "", pageOffset: 0, pageSize: 24, searchTerm: query,
    }),
    extensions: JSON.stringify({ persistedQuery: { version: 1, sha256Hash: searchHash } }),
  });
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Origin: "https://store.playstation.com",
      "X-PSN-Store-Locale-Override": "uk-UA",
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("PlayStation search returned HTTP " + response.status);
  const payload = await response.json();
  const results = payload.data?.universalSearch?.results;
  if (!Array.isArray(results)) throw new Error("PlayStation search returned no result list");

  const games = new Map();
  for (const item of results) {
    if (typeof item?.name !== "string" || !item.name.trim()) continue;
    const kind = item.__typename === "Concept" ? "c" : "p";
    if (kind === "p" && !gameTypes.has(item.storeDisplayClassification)) continue;
    const key = kind + ":" + item.id;
    const listing = listingFromKey(key);
    if (!listing) continue;
    const name = titleParts(item.name);
    const platforms = (item.platforms ?? []).filter(p => p === "PS4" || p === "PS5");
    const label = platforms.length && !name.platforms.length ? item.name + " (" + platforms.join(" / ") + ")" : item.name;
    games.set(key, {
      listing, key, label,
      title: name.title,
      platforms: new Set([...platforms, ...name.platforms]),
      relatedProducts: (item.products ?? []).map(product => product?.id).filter(Boolean),
    });
  }
  return [...games.values()];
}

export function matchGames(query, games) {
  const wanted = titleParts(query);
  if (!wanted.title) return { exact: false, games: [] };
  const eligible = games.filter(game => wanted.platforms.every(platform => game.platforms.has(platform)));
  const productTitles = new Map(eligible.filter(game => game.listing.kind === "p")
    .map(game => [game.listing.id, game.title]));
  const distinct = eligible.filter(game => !game.relatedProducts.some(id => productTitles.get(id) === game.title));
  const exact = distinct.filter(game => game.title === wanted.title);
  if (exact.length) return { exact: exact.length === 1, games: exact.slice(0, 6) };

  const words = wanted.title.split(" ");
  const related = distinct.filter(game => {
    const gameWords = new Set(game.title.split(" "));
    return words.every(word => gameWords.has(word));
  });
  // Sony can return a localized title with different words from the query.
  return { exact: false, games: (related.length ? related : distinct).slice(0, 6) };
}

function centsFromLabel(text) {
  const label = text.replace(/&nbsp;|&#160;|&#xa0;/gi, " ").replace(/\s+/gu, " ").trim();
  if (label.toLowerCase() === "безкоштовно") return 0;
  const match = /^UAH\s*([0-9]+(?: [0-9]{3})*)(?:,([0-9]{2}))?$/u.exec(label);
  if (!match) return null;
  return Number(match[1].replaceAll(" ", "")) * 100 + Number(match[2] ?? 0);
}

function schemaProduct(html) {
  const scripts = /<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const [, body] of html.matchAll(scripts)) {
    let value;
    try { value = JSON.parse(body); } catch { continue; }
    if (value?.["@type"] === "Product" && typeof value.name === "string" && value.name) return value;
  }
  throw new Error("PlayStation listing has no product data");
}

export function productFromHtml(html, listing) {
  const product = schemaProduct(html);
  if (listing.kind === "p" && product.sku !== listing.id) return null;

  const offerNodes = /data-qa="mfeCtaMain#offer([0-9]+)#(finalPrice|discountInfo|serviceIcon#ps-plus)"[^>]*>([^<]*)/g;
  const offers = new Map();
  for (const [, index, role, text] of html.matchAll(offerNodes)) {
    const offer = offers.get(index) ?? {};
    offer[role] = text;
    offers.set(index, offer);
  }
  const prices = [...offers.values()].filter(offer => !Object.hasOwn(offer, "serviceIcon#ps-plus") &&
    !/ознайомлен|пробн|підпиш|тільки для підпис|trial/iu.test(offer.discountInfo ?? ""))
    .map(offer => centsFromLabel(offer.finalPrice ?? "")).filter(price => price !== null);

  const schemaPrice = product.offers?.price;
  const schemaCents = product.offers?.priceCurrency === "UAH" &&
    (typeof schemaPrice === "number" || (typeof schemaPrice === "string" && /^\d+(?:\.\d+)?$/.test(schemaPrice)))
    ? Math.round(Number(schemaPrice) * 100) : null;
  let priceCents = prices[0] ?? null;
  if (Number.isSafeInteger(schemaCents) && schemaCents >= 0 &&
    (prices.includes(schemaCents) || !offers.size)) priceCents = schemaCents;

  const tagNodes = /data-qa="mfe-game-title#productTag\d+"[^>]*>([^<]*)/g;
  const tags = [...new Set([...html.matchAll(tagNodes)].map(([, tag]) => tag.trim()))]
    .filter(tag => tag && tag.toLowerCase() !== product.name.toLowerCase());
  return { name: product.name, tags, priceCents };
}

export async function fetchListing(listing) {
  const response = await fetch(listing.url, {
    headers: { Accept: "text/html", "Accept-Language": "uk-UA,uk;q=0.9" },
    signal: AbortSignal.timeout(8000),
  });
  if (response.status === 404 || response.status === 410) return null;
  if (!response.ok) throw new Error("PlayStation listing returned HTTP " + response.status);
  const final = new URL(response.url || listing.url);
  if (final.origin !== "https://store.playstation.com" || !final.pathname.startsWith("/uk-ua/")) {
    throw new Error("PlayStation redirected away from the Ukrainian Store");
  }
  return productFromHtml(await response.text(), listing);
}
