import type { Metadata } from "next";

export const metadata: Metadata = { title: "DEESSE · Data deletion" };

/** Public page for Meta (Facebook / Instagram) and GDPR: how to delete your chat data. */
export default function DataDeletion() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-12 text-sm leading-relaxed text-zinc-800">
      <h1 className="mb-4 text-2xl font-semibold">DEESSE shop assistant: your data</h1>
      <p className="mb-3">
        Deisi, the AI assistant of DEESSE OÜ (deesse.ee), answers messages from the website chat, e-mail, Instagram and Facebook Messenger. To answer
        and to keep the conversation, we store the messages, your name and e-mail if you give them, and for Instagram / Messenger the
        page-scoped user id that Meta sends us. We use this data only to answer you and to process your orders. We do not sell it or use it for
        advertising.
      </p>
      <h2 className="mt-6 mb-2 text-lg font-semibold">How to delete your data</h2>
      <p className="mb-3">
        Write to <a className="underline" href="mailto:info@deesse.ee">info@deesse.ee</a> with the subject “Delete my data” and tell us the
        channel (website chat, e-mail, Instagram or Messenger) and your name or username. We delete the conversation and the related data within
        30 days and confirm it by e-mail. Order data that we must keep by law (accounting) is kept for the period the law requires.
      </p>
      <p className="mb-3">
        Eesti keeles: andmete kustutamiseks kirjutage aadressile info@deesse.ee, teema “Kustuta minu andmed”. По-русски: для удаления данных
        напишите на info@deesse.ee с темой «Удалить мои данные».
      </p>
      <p className="mt-6 text-zinc-500">
        Privacy policy: <a className="underline" href="https://deesse.ee/policies/privacy-policy">deesse.ee/policies/privacy-policy</a>
      </p>
    </main>
  );
}
