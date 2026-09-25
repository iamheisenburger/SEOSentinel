import type { Metadata } from "next";
import { XReplyHandoffView } from "./x-reply-handoff";

export const metadata: Metadata = {
  title: "Reply on X",
  robots: { index: false, follow: false },
};

export default function XReplyPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[560px] flex-col justify-center px-5 py-10">
      <XReplyHandoffView />
    </main>
  );
}
