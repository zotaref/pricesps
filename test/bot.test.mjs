import assert from "node:assert/strict";
import test from "node:test";
import { calculatePrice } from "../src/prices.mjs";
import { listingFromKey, productFromHtml } from "../src/playstation.mjs";
import { secretHeader, webhookSecret } from "../src/auth.mjs";
import worker from "../src/worker.mjs";

const token = "100:example_unit_test_token_only";
const env = { TELEGRAM_BOT_TOKEN: token };
const workerUrl = "https://ps-store-ua-price-bot.example.workers.dev/telegram";
const astro = "EP9000-PPSA21567_00-0000000000000000";
const minecraft4 = "EP4433-CUSA00265_00-MINECRAFTPS40001";
const minecraft5 = "UP4433-PPSA17221_00-MINECRAFTPS50000";

function update(message) {
  return { update_id: 5, message: { chat: { id: 42, type: "private" }, text: message } };
}

async function webhook(body, secret = null, context = { waitUntil() {} }) {
  const headers = { "Content-Type": "application/json" };
  headers[secretHeader] = secret ?? await webhookSecret(token);
  return worker.fetch(new Request(workerUrl, { method: "POST", headers, body: JSON.stringify(body) }), env, context);
}

function page(name, sku, offer, markup) {
  return "<script type=\"application/ld+json\">" +
    JSON.stringify({ "@type": "Product", name, sku, offers: offer }) + "</script>" + markup;
}

function searchResult(...results) {
  return Response.json({ data: { universalSearch: { results } } });
}

test("matches the spreadsheet example and every markup boundary", () => {
  const expected = [[0, 0], [1, 8001], [50099, 58099], [50100, 59100], [100099, 109099],
    [100100, 114100], [200099, 214099], [200100, 220100], [250099, 270099], [250100, 277600]];
  for (const [store, total] of expected) assert.equal(calculatePrice(store).totalCents, total);
  assert.deepEqual(calculatePrice(430000), { totalCents: 457500, convertedCents: 10566 });
});

test("rejects unauthenticated updates and serves only the expected routes", async () => {
  assert.equal((await webhook(update("/start"), "invalid")).status, 401);
  const response = await webhook(update("/start"));
  assert.equal(response.status, 200);
  assert.match((await response.json()).text, /Напиши назву гри/);
  assert.equal((await worker.fetch(new Request(workerUrl), env)).status, 404);
});

test("calculates prices from the Ukrainian listing and returns a Telegram reply", async t => {
  t.mock.method(globalThis, "fetch", async url => {
    const location = new URL(url);
    if (location.hostname === "web.np.playstation.com") {
      const params = JSON.parse(location.searchParams.get("variables"));
      assert.equal(params.countryCode, "UA");
      assert.equal(params.searchTerm, "ASTRO BOT");
      return searchResult({ __typename: "Product", name: "ASTRO BOT", id: astro, storeDisplayClassification: "FULL_GAME" });
    }
    assert.equal(location.pathname, "/uk-ua/product/" + astro);
    return new Response(page("ASTRO BOT", astro, { priceCurrency: "UAH", price: 1419.29 },
      '<span data-qa="mfeCtaMain#offer0#finalPrice">UAH&nbsp;1 419,29</span>'));
  });
  const message = await (await webhook(update("ASTRO BOT"))).json();
  assert.equal(message.method, "sendMessage");
  assert.equal(message.chat_id, 42);
  assert.match(message.text, /1\s559,29 грн/);
  assert.match(message.text, /36,01/);
  assert.equal(message.reply_markup.inline_keyboard[0][0].url, "https://store.playstation.com/uk-ua/product/" + astro);
});

test("asks for a platform, acknowledges the choice and skips the free trial", async t => {
  const pending = [];
  let callbackId;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const location = new URL(url);
    if (location.hostname === "web.np.playstation.com") {
      return searchResult(...[minecraft4, minecraft5].map((id, index) => ({
        __typename: "Product", id, name: "Minecraft", platforms: ["PS" + (4 + index)], storeDisplayClassification: "FULL_GAME",
      })));
    }
    if (location.hostname === "api.telegram.org") {
      callbackId = JSON.parse(options.body).callback_query_id;
      return Response.json({ ok: true });
    }
    assert.equal(location.pathname, "/uk-ua/product/" + minecraft5);
    return new Response(page("Minecraft", minecraft5, { priceCurrency: "UAH", price: 649 },
      '<span data-qa="mfeCtaMain#offer0#finalPrice">Безкоштовно</span>' +
      '<span data-qa="mfeCtaMain#offer0#discountInfo">Ознайомлення</span>' +
      '<span data-qa="mfeCtaMain#offer1#finalPrice">UAH 649,00</span>'));
  });
  const selection = await (await webhook(update("Minecraft"))).json();
  assert.deepEqual(selection.reply_markup.inline_keyboard.map(([b]) => b.text), ["Minecraft (PS4)", "Minecraft (PS5)"]);
  const data = selection.reply_markup.inline_keyboard[1][0].callback_data;
  const body = { update_id: 6, callback_query: { id: "query-id", data, message: { chat: { id: 42, type: "private" } } } };
  const response = await webhook(body, null, { waitUntil(task) { pending.push(task); } });
  await Promise.all(pending);
  assert.equal(callbackId, "query-id");
  assert.match((await response.json()).text, /739,00 грн/);
});

test("discards subscriber-only offers and accepts genuinely free games", () => {
  const listing = listingFromKey("p:" + astro);
  const html = page("ASTRO BOT", astro, { priceCurrency: "UAH", price: 100 },
    '<span data-qa="mfeCtaMain#offer0#finalPrice">UAH 100,00</span>' +
    '<span data-qa="mfeCtaMain#offer0#serviceIcon#ps-plus">Plus</span>' +
    '<span data-qa="mfeCtaMain#offer1#finalPrice">UAH 200,00</span>');
  assert.equal(productFromHtml(html, listing).priceCents, 20000);
  assert.equal(productFromHtml(page("ASTRO BOT", astro, {},
    '<span data-qa="mfeCtaMain#offer0#finalPrice">Безкоштовно</span>'), listing).priceCents, 0);
});
