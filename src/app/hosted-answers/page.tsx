import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { api } from "../../../convex/_generated/api";
import { convexHttp } from "@/lib/convexHttpClient";
import { isHostedAnswersHost, requestHost } from "@/lib/hosted-answers";
import { HostedAnswersShell } from "./shell";

export const dynamic = "force-dynamic";

const getIndex = cache(async (host: string) => {
  try { return await convexHttp.query(api.answerPublish.hostedIndex, { host }); } catch { return null; }
});

export async function generateMetadata(): Promise<Metadata> {
  const host = await requestHost();
  const index = isHostedAnswersHost(host) ? await getIndex(host) : null;
  if (!index) return { title: "Not found", robots: { index: false } };
  return { title: { absolute: `${index.business.name} answers` }, description: `Answers to the questions buyers ask about ${index.business.name}.`,
    alternates: { canonical: `https://${host}/` } };
}

export default async function HostedAnswersIndex() {
  const host = await requestHost();
  if (!isHostedAnswersHost(host)) notFound();
  const index = await getIndex(host);
  if (!index) notFound();
  return (
    <HostedAnswersShell business={index.business}>
      <main>
        <h1>{index.business.name} answers</h1>
        <p className="ha-meta">Direct answers to the questions buyers ask.</p>
        {index.pages.length ? (
          <ul className="ha-list">
            {index.pages.map((page) => (
              <li key={page.slug}><Link href={`/${page.slug}`}><strong>{page.title}</strong><span>{page.metaDescription}</span></Link></li>
            ))}
          </ul>
        ) : <p className="ha-body">The first answers are on their way.</p>}
      </main>
    </HostedAnswersShell>
  );
}
