import { appendFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { secretHeader, tokenPattern, webhookSecret } from "../src/auth.mjs";

async function telegram(token, method, params = {}) {
  let response;
  try {
    response = await fetch("https://api.telegram.org/bot" + token + "/" + method, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new Error("Telegram did not respond to " + method);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    throw new Error("Telegram rejected " + method + " (HTTP " + response.status + ")");
  }
  return data.result;
}

function workerEndpoint(deploymentUrl) {
  const url = new URL(deploymentUrl);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".workers.dev") || url.username || url.password || url.port) {
    throw new Error("Expected a Worker deployment URL on workers.dev");
  }
  return new URL("/telegram", url).href;
}

async function probe(url, secret) {
  // Telegram normally executes the returned sendMessage. This probe only reads it.
  const body = JSON.stringify({ update_id: 1, message: { chat: { id: 1, type: "private" }, text: "ASTRO BOT" } });
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "PlayStationPriceBotDeployment/1.0",
          [secretHeader]: secret,
        },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
      const reply = await response.json().catch(() => null);
      if (response.ok && reply?.method === "sendMessage" &&
        reply.text?.includes("<b>ASTRO BOT</b>") && reply.text.includes("З націнкою")) return;
    } catch {
      // A new deployment or updated secret can take a moment to propagate.
    }
    if (attempt < 4) await setTimeout(3000);
  }
  throw new Error("The deployed Worker did not return a price for ASTRO BOT. Check its deployment and logs.");
}

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  const deploymentUrl = process.env.WORKER_DEPLOYMENT_URL?.trim();
  if (!tokenPattern.test(token)) throw new Error("Set the TELEGRAM_BOT_TOKEN repository secret to the token from BotFather");
  if (!deploymentUrl) throw new Error("No Worker URL was returned by the deploy step. Set up the account workers.dev subdomain");
  const url = workerEndpoint(deploymentUrl);
  const secret = await webhookSecret(token);
  const identity = await telegram(token, "getMe");
  if (!/^[A-Za-z0-9_]+$/.test(identity?.username ?? "")) throw new Error("Telegram did not return the bot username");

  await probe(url, secret);
  console.log("Verified a live PlayStation Store price from the deployed Worker.");
  await telegram(token, "setWebhook", {
    url, secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: false,
  });
  const info = await telegram(token, "getWebhookInfo");
  if (info?.url !== url) throw new Error("Telegram did not confirm the expected webhook URL");

  const botUrl = "https://t.me/" + identity.username;
  console.log("Бот підключено до Telegram — " + botUrl);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, "## Бот підключено\n\n[Відкрити в Telegram](" + botUrl + ")\n");
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
