/** On every start: connect the shop bot's Telegram webhook (when TELEGRAM_BOT_TOKEN is set). */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./instrumentation-node");
}
