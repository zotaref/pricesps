import { secretHeader, secretMatches, tokenPattern, webhookSecret } from "./auth.mjs";
import { fetchListing, listingFromKey, matchGames, searchPage, searchStore } from "./playstation.mjs";
import { calculatePrice, formatCents, rateTenths } from "./prices.mjs";

const help = "Напиши назву гри, наприклад ASTRO BOT або Minecraft.\n\n" +
  "Покажу ціну в українському PlayStation Store, суму з націнкою й підсумок за формулою з таблиці.";
const rate = String(rateTenths / 10).replace(".", ",");

function html(text) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function reply(chatId, text, buttons) {
  const result = {
    method: "sendMessage",
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  };
  if (buttons) result.reply_markup = { inline_keyboard: buttons };
  return result;
}

function storeButton(url, text = "Відкрити в PlayStation Store") {
  return [[{ text, url }]];
}

function priceText(listing) {
  const title = "<b>" + html(listing.name) + "</b>" +
    (listing.tags.length ? "\n" + html(listing.tags.join(" · ")) : "");
  if (listing.priceCents === null) return title + "\n\nЦіна придбання в PlayStation Store наразі відсутня.";

  const { totalCents, convertedCents } = calculatePrice(listing.priceCents);
  const storePrice = listing.priceCents ? formatCents(listing.priceCents) + " грн" : "безкоштовно";
  return title + "\n\nPlayStation Store — " + storePrice +
    "\nЗ націнкою — <b>" + formatCents(totalCents) + " грн</b>" +
    "\nПідсумок за курсом " + rate + " — " + formatCents(convertedCents);
}

async function quote(chatId, listing) {
  let text;
  try {
    const product = await fetchListing(listing);
    text = product ? priceText(product) : "Це видання наразі недоступне в PlayStation Store.";
  } catch {
    text = "Не вдалося отримати ціну з PlayStation Store. Спробуй ще раз трохи пізніше.";
  }
  return reply(chatId, text, storeButton(listing.url));
}

async function handleMessage(message) {
  const chat = message.chat;
  if (chat?.type !== "private" || !Number.isSafeInteger(chat.id)) return null;
  const query = typeof message.text === "string" ? message.text.replace(/\s+/gu, " ").trim() : "";
  if (!query || query.startsWith("/")) return reply(chat.id, help);
  if (query.length > 200) return reply(chat.id, "Надішли назву гри до 200 символів.");

  let matches;
  try {
    matches = matchGames(query, await searchStore(query));
  } catch {
    return reply(chat.id, "Пошук PlayStation Store тимчасово недоступний. Спробуй ще раз трохи пізніше.");
  }
  if (matches.exact) return quote(chat.id, matches.games[0].listing);
  if (matches.games.length) {
    const buttons = matches.games.map(game => [{ text: Array.from(game.label).slice(0, 110).join(""), callback_data: game.key }]);
    return reply(chat.id, "Вибери потрібну гру чи видання або надішли точнішу назву.", buttons);
  }
  return reply(chat.id, "Не знайшов гри за цією назвою. Спробуй написати її так, як вона вказана в PlayStation Store.",
    storeButton(searchPage(query), "Пошукати в PlayStation Store"));
}

async function answerCallback(token, id) {
  try {
    const response = await fetch("https://api.telegram.org/bot" + token + "/answerCallbackQuery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: id }),
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    await response.body?.cancel();
  } catch {
    // The price reply can still be delivered if Telegram cannot close the button spinner.
  }
}

async function handleUpdate(update, token, ctx) {
  if (update?.message) return handleMessage(update.message);
  const callback = update?.callback_query;
  if (typeof callback?.id !== "string") return null;
  ctx.waitUntil(answerCallback(token, callback.id));

  const chat = callback.message?.chat;
  const listing = listingFromKey(callback.data);
  if (chat?.type === "private" && Number.isSafeInteger(chat.id) && listing) return quote(chat.id, listing);
  return null;
}

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    const token = env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
    if (path === "/health" && request.method === "GET") {
      const ready = tokenPattern.test(token);
      return Response.json({ ok: ready }, { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } });
    }
    if (path !== "/telegram" || request.method !== "POST") return new Response("Not found", { status: 404 });
    if (!tokenPattern.test(token)) return new Response("Unavailable", { status: 503 });
    if (!secretMatches(request.headers.get(secretHeader), await webhookSecret(token))) {
      return new Response("Unauthorized", { status: 401 });
    }

    let update;
    try { update = await request.json(); } catch { return new Response("Invalid update", { status: 400 }); }
    if (!Number.isSafeInteger(update?.update_id)) return new Response("Invalid update", { status: 400 });
    const result = await handleUpdate(update, token, ctx);
    return result ? Response.json(result) : new Response("OK");
  },
};
