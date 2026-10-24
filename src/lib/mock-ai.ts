import { DEESY_PROMPT_NAME, DEESY_SIGNATURE } from "./default-prompts";

export type ChatSettings = { temperature: number; topP: number };
export type PromptRef = { name: string; content: string } | null;

type Lang = "en" | "et" | "ru";

const MOCK_DELAY_MS = 1500;

export const MODEL_LABELS: Record<string, string> = {
  "gpt-4": "GPT-4",
  claude: "Claude",
  "local-llama": "Local Llama",
};

/** Simulates an LLM call: waits 1.5s and returns a canned answer. */
export async function sendMessage(
  text: string,
  model: string,
  settings: ChatSettings,
  systemPrompt: PromptRef,
): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, MOCK_DELAY_MS));

  if (systemPrompt?.name === DEESY_PROMPT_NAME) return deesyReply(text);

  const persona = systemPrompt?.name ?? "General assistant";
  const modelLabel = MODEL_LABELS[model] ?? model;
  return genericReply(text, persona, modelLabel, settings);
}

export function detectLanguage(text: string): Lang {
  if (/[а-яё]/i.test(text)) return "ru";
  if (/[õäöüšž]/i.test(text)) return "et";
  const etWords =
    /\b(tere|palun|aitäh|soovin|tahan|kingad|kingi|suurus|kas|mis|kuidas|hind|tellida|osta|saatmine|pakiautomaat|jah|ei|mul|minu|teil)\b/i;
  return etWords.test(text) ? "et" : "en";
}

function has(text: string, pattern: RegExp) {
  return pattern.test(text.toLowerCase());
}

const T = {
  greeting: {
    en: "Thank you for reaching out to DEESSE!",
    et: "Aitäh, et pöördusite DEESSE poole!",
    ru: "Спасибо, что обратились в DEESSE!",
  },
  shoes: {
    en: "For pole and exotic dance I recommend our **Pleaser platform heels (7–8\" / 18–20 cm)** — stable platform, secure ankle strap and a perfect line for spins and floorwork. If you are a beginner, a 6\" (15 cm) heel is a great start.",
    et: "Pole- ja exotic-tantsuks soovitan meie **Pleaser platvormkingi (18–20 cm)** — stabiilne platvorm, kindel pahkluurihm ja ilus jalajoon pöörete ja põrandatehnikate jaoks. Algajale sobib suurepäraselt 15 cm konts.",
    ru: "Для pole и exotic рекомендую наши **туфли Pleaser на платформе (18–20 см)** — устойчивая платформа, надёжный ремешок на щиколотке и красивая линия ноги для вращений и партера. Для начинающих отлично подойдёт каблук 15 см.",
  },
  catsuit: {
    en: "I recommend one of our **shimmer catsuits** — a second-skin fit, comfortable stretch for training and a stunning look on stage.",
    et: "Soovitan üht meie **säravat catsuit'i** — istub nagu teine nahk, mugavalt veniv treeninguks ja näeb laval vapustav välja.",
    ru: "Рекомендую один из наших **блестящих кэтсьютов** — сидит как вторая кожа, удобно тянется на тренировках и эффектно смотрится на сцене.",
  },
  kneepads: {
    en: "For floorwork I recommend our **soft knee pads** — thin enough to stay invisible under leggings, with excellent protection on hard floors.",
    et: "Põrandatehnikate jaoks soovitan meie **pehmeid põlvekaitsmeid** — piisavalt õhukesed, et retuuside all mitte silma paista, ja kaitsevad kõval põrandal suurepäraselt.",
    ru: "Для партера рекомендую наши **мягкие наколенники** — достаточно тонкие, чтобы быть незаметными под леггинсами, и отлично защищают на жёстком полу.",
  },
  general: {
    en: "To recommend the perfect product, could you tell me your dance style (pole, exotic, heels), your experience level and your shoe size?",
    et: "Et soovitada just teile sobivat toodet, palun kirjutage oma tantsustiil (pole, exotic, heels), kogemuse tase ja kingasuurus.",
    ru: "Чтобы подобрать идеальный товар, подскажите, пожалуйста, ваш стиль танца (pole, exotic, heels), уровень подготовки и размер обуви.",
  },
  addons: {
    en: "To complete the set, I suggest: **knee pads** for floorwork, **shoe protectors** to keep your heels pristine, and a **grip aid** for a secure hold on the pole.",
    et: "Komplekti täienduseks soovitan: **põlvekaitsmeid** põrandatehnikate jaoks, **kingakaitseid**, et kingad püsiksid laitmatud, ja **grip-vahendit** kindlamaks haardeks.",
    ru: "Для полного комплекта советую: **наколенники** для партера, **протекторы для обуви**, чтобы туфли оставались идеальными, и **средство для сцепления** для уверенного хвата на пилоне.",
  },
  addonsCatsuit: {
    en: "It pairs beautifully with matching **pole shoes**, **knee pads** for floorwork and a **grip aid** — catsuits can be slippery on the pole.",
    et: "Sellega sobivad suurepäraselt **pole-kingad**, **põlvekaitsmed** põrandatehnikate jaoks ja **grip-vahend** — catsuit võib postil libiseda.",
    ru: "К нему отлично подойдут **туфли для pole**, **наколенники** для партера и **средство для сцепления** — кэтсьют может скользить на пилоне.",
  },
  pickup: {
    en: "Self-collection is perfect — your order will be ready at **Tatari 64** or **Ehitajate tee 114b** (Tallinn), whichever is more convenient for you.",
    et: "Ise järele tulemine sobib suurepäraselt — tellimus ootab teid aadressil **Tatari 64** või **Ehitajate tee 114b** (Tallinn), vastavalt teie eelistusele.",
    ru: "Самовывоз — отличный вариант! Заказ будет ждать вас по адресу **Tatari 64** или **Ehitajate tee 114b** (Таллинн), как вам удобнее.",
  },
  tallinn: {
    en: "Since you are in Tallinn — would you prefer **shipping** or **self-collection**? You can pick up your order at **Tatari 64** or **Ehitajate tee 114b**.",
    et: "Kuna olete Tallinnas — kas eelistate **saatmist** või **ise järele tulla**? Tellimuse saate kätte aadressilt **Tatari 64** või **Ehitajate tee 114b**.",
    ru: "Так как вы в Таллинне — вам удобнее **доставка** или **самовывоз**? Забрать заказ можно по адресу **Tatari 64** или **Ehitajate tee 114b**.",
  },
  shipping: {
    en: "We recommend delivery to a **parcel machine** — fast and convenient. Shipping to a parcel machine is **free for orders over 175 EUR**, and there is no minimum order value.",
    et: "Soovitame tarnet **pakiautomaati** — kiire ja mugav. Saatmine pakiautomaati on **tasuta üle 175 EUR tellimustele** ja minimaalset tellimuse summat ei ole.",
    ru: "Рекомендуем доставку в **пакоматы** — быстро и удобно. Доставка в пакомат **бесплатна при заказе от 175 EUR**, минимальной суммы заказа нет.",
  },
  order: {
    en: "Wonderful! I will prepare a **draft order** with the selected products. Once you approve it, I will send you a secure **payment link**: https://deesse.ee/pay/mock-draft-1024 (demo). After payment, your order is created and you receive a confirmation.",
    et: "Suurepärane! Koostan valitud toodetega **tellimuse mustandi**. Kui olete selle kinnitanud, saadan teile turvalise **makselingi**: https://deesse.ee/pay/mock-draft-1024 (demo). Pärast makset luuakse tellimus ja saate kinnituse.",
    ru: "Отлично! Я подготовлю **черновик заказа** с выбранными товарами. После вашего подтверждения отправлю защищённую **ссылку на оплату**: https://deesse.ee/pay/mock-draft-1024 (демо). После оплаты заказ будет создан, и вы получите подтверждение.",
  },
  discount: {
    en: "I understand. To help you decide, I can offer a **7% discount** on this order if you confirm today.",
    et: "Saan aru. Et otsustamine oleks lihtsam, saan pakkuda sellele tellimusele **7% allahindlust**, kui kinnitate täna.",
    ru: "Понимаю. Чтобы вам было проще решиться, могу предложить **скидку 7%** на этот заказ при подтверждении сегодня.",
  },
  next: {
    en: "Which size would you like, and shall I prepare the order for you?",
    et: "Millist suurust soovite ja kas valmistan teile tellimuse ette?",
    ru: "Какой размер вам нужен, и подготовить для вас заказ?",
  },
} satisfies Record<string, Record<Lang, string>>;

export function deesyReply(text: string): string {
  const lang = detectLanguage(text);
  const parts: string[] = [T.greeting[lang]];

  const wantsShoes = has(text, /shoe|heel|pleaser|king|konts|туфл|обув|каблук|платформ/);
  const wantsCatsuit = has(text, /catsuit|bodysuit|body|kostüüm|кэтсьют|комбинезон|боди/);
  const wantsKneepads = has(text, /knee|põlv|колен/);
  const isTallinn = has(text, /tallinn|таллин/);
  const asksShipping = has(text, /ship|deliver|parcel|saat|tarne|pakiautomaat|достав|пакомат|посылк/);
  const wantsOrder = has(text, /\b(buy|order|purchase|checkout|take it)\b|osta|telli|võtan|купить|куплю|заказ|беру|оформ/);
  const priceObjection = has(text, /expensive|discount|cheaper|kallis|allahind|soodus|дорого|скидк|дешевле/);
  const wantsPickup = has(text, /pick ?up|self-collect|collect it|järele|tatari|ehitajate|самовывоз|заберу/);
  const wantsProduct = wantsShoes || wantsCatsuit || wantsKneepads;

  if (wantsShoes) parts.push(T.shoes[lang]);
  if (wantsCatsuit) parts.push(T.catsuit[lang]);
  if (wantsKneepads && !wantsShoes) parts.push(T.kneepads[lang]);
  if (wantsShoes) parts.push(T.addons[lang]);
  else if (wantsCatsuit) parts.push(T.addonsCatsuit[lang]);
  if (!wantsProduct && !wantsOrder && !asksShipping && !isTallinn && !wantsPickup && !priceObjection)
    parts.push(T.general[lang]);
  if (priceObjection) parts.push(T.discount[lang]);

  // Tallinn buyers choose shipping or self-collection before a draft order is made.
  const deliveryChosen = wantsPickup || asksShipping || !isTallinn;
  if (wantsPickup) parts.push(T.pickup[lang]);
  else if (isTallinn && !asksShipping) parts.push(T.tallinn[lang]);
  if (asksShipping || (wantsOrder && !isTallinn && !wantsPickup)) parts.push(T.shipping[lang]);

  if ((wantsOrder || wantsPickup) && deliveryChosen) parts.push(T.order[lang]);
  else if (wantsProduct && deliveryChosen) parts.push(T.next[lang]);

  return ensureDeesySignature(parts.join("\n\n"));
}

export function ensureDeesySignature(reply: string): string {
  const trimmed = reply.trimEnd();
  if (trimmed.endsWith(DEESY_SIGNATURE)) return trimmed;
  return `${trimmed}\n\n${DEESY_SIGNATURE}`;
}

function genericReply(text: string, persona: string, model: string, settings: ChatSettings): string {
  const quote = text.length > 120 ? `${text.slice(0, 120)}…` : text;
  const intro: Record<string, string> = {
    Coder: "Here's how I'd approach this from an engineering perspective:",
    Writer: "Here's a polished take on your request:",
    Math: "Let's work through this step by step:",
  };
  return [
    intro[persona] ?? "Here's my answer:",
    `> ${quote}`,
    `This is a simulated response from **${model}** acting as **${persona}** (temperature ${settings.temperature.toFixed(1)}, top-p ${settings.topP.toFixed(1)}). Real model integrations will be connected later.`,
  ].join("\n\n");
}
