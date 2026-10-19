"use client";

import { ReactNode, useEffect, useState } from "react";

import { Page, PageHeader } from "@/components/layout/page";
import { LogoPreview } from "@/components/layout/logo-preview";
import { ThemeCards } from "@/components/layout/theme-switcher";

import { ComparePreview } from "./compare-preview";
import { DraftingAnimation } from "./drafting-animation";
import { ModelAnimation } from "./model-animation";
import { ProcessingView } from "./processing-view";
import { ScanAnimation } from "./scan-animation";

/** The status messages a real conversion sends, on a made-up schedule (ms from start). */
const SIMULATED_STATUS: [number, string][] = [
  [0, "Förbereder uppladdad bild"],
  [2500, "Ritar om planritningen"],
  [16000, "Ritar om mot stilmallen"],
  [24000, "Sätter ram och logotyp"],
  [27500, "Sparar planritning"],
];
/** Long enough for the drawing board to go through all of its homes once. */
const SIMULATED_LOOP_MS = 30000;

function useSimulatedStatus() {
  const [total, setTotal] = useState(0);
  useEffect(() => {
    const startedAt = Date.now();
    const intervalId = window.setInterval(() => setTotal(Date.now() - startedAt), 250);
    return () => window.clearInterval(intervalId);
  }, []);
  const elapsed = total % SIMULATED_LOOP_MS;
  return {
    status: SIMULATED_STATUS.filter(([from]) => elapsed >= from).at(-1)?.[1] ?? null,
    /** Which pass of the made-up conversion this is, to restart the view with it. */
    run: Math.floor(total / SIMULATED_LOOP_MS),
  };
}

const PROPOSALS: {
  key: string;
  title: string;
  description: string;
  animation: ReactNode;
  expectedMs?: number | null;
}[] = [
  {
    key: "A",
    title: "Ritbordet (vald)",
    description:
      "Ett nytt hus varje varv. Pennan lämnar ett glödande spår, måtten och ytorna räknas upp, rumsnamnen skrivs fram och det färdiga bladet läggs på högen. Till höger: förlopp mot hur lång tid det brukar ta, och tips att läsa medan man väntar.",
    animation: <DraftingAnimation />,
    expectedMs: SIMULATED_LOOP_MS,
  },
  {
    key: "A2",
    title: "Ritbordet, första gången",
    description:
      "Innan enheten har mätt någon generering finns ingen uppskattning, så indikatorn rör sig utan att lova något.",
    animation: <DraftingAnimation />,
    expectedMs: null,
  },
  {
    key: "B",
    title: "Före och efter",
    description:
      "En gammal handritad ritning läses av en stråle i er färg. Bakom strålen står den nya ritningen redan klar, och hörnen tänds när de hittas.",
    animation: <ScanAnimation />,
  },
  {
    key: "C",
    title: "Modellen",
    description:
      "Planen reser sig till en arkitektmodell i 3D, vrids långsamt och fälls sedan ner till det färdiga bladet.",
    animation: <ModelAnimation />,
  },
];

export function AnimationPreview() {
  const { status, run } = useSimulatedStatus();

  return (
    <div className="min-h-screen bg-canvas">
      <Page width="wide">
        <PageHeader
          eyebrow="Endast i utvecklingsläge"
          title="Förhandsvisning"
          description="Förslagen visas i samma ram som när en planritning genereras. Stegen till höger är påhittade och går runt i en loop, så att du ser hela förloppet utan att generera."
        />
        <section aria-labelledby="logos" className="mb-12">
          <h2 id="logos" className="text-lg font-semibold text-stone-900">Logga</h2>
          <p className="mb-4 mt-0.5 max-w-2xl text-sm text-stone-500">
            Överst den orange cirkeln med ett enda vitt verktyg eller symbol, sedan övriga cirkelvarianter och de tidigare pennidéerna. Varje kort visar loggan på ljus och mörk botten, i headern bredvid kundens logga och i favicon-storlek.
          </p>
          <LogoPreview />
        </section>

        <section aria-labelledby="themes" className="mb-12">
          <h2 id="themes" className="text-lg font-semibold text-stone-900">Färgtema</h2>
          <p className="mb-4 mt-0.5 max-w-2xl text-sm text-stone-500">
            Välj ett tema och klicka runt i appen. Valet sparas i den här webbläsaren, och i appen
            finns en liten växlare nere till höger.{" "}
            <a href="/startsida" className="font-medium text-stone-900 underline underline-offset-4">
              Öppna appen
            </a>
          </p>
          <ThemeCards />
        </section>
        <div className="max-w-4xl space-y-12">
          {PROPOSALS.map((proposal) => (
            <section key={proposal.key} aria-labelledby={`proposal-${proposal.key}`}>
              <div className="mb-4 flex items-baseline gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-stone-900 text-xs font-semibold text-white">
                  {proposal.key}
                </span>
                <div>
                  <h2 id={`proposal-${proposal.key}`} className="text-lg font-semibold text-stone-900">
                    {proposal.title}
                  </h2>
                  <p className="mt-0.5 max-w-2xl text-sm text-stone-500">{proposal.description}</p>
                </div>
              </div>
              <div className="w-full rounded-2xl border border-stone-200 bg-white p-4 shadow-[0_1px_2px_rgba(28,25,23,0.04),0_16px_40px_-24px_rgba(28,25,23,0.16)] sm:p-6">
                <ProcessingView
                  key={run}
                  statusMessage={status}
                  label="Storgatan 12, Göteborg"
                  animation={proposal.animation}
                  expectedMs={proposal.expectedMs}
                />
              </div>
            </section>
          ))}

          <section aria-labelledby="proposal-compare">
            <div className="mb-4">
              <h2 id="proposal-compare" className="text-lg font-semibold text-stone-900">
                Jämförelsereglaget
              </h2>
              <p className="mt-0.5 max-w-2xl text-sm text-stone-500">
                Originalet sträcks så att dess väggar ligger exakt över de nya, så att man ser precis
                vad som ändrats. Välj en befintlig planritning och slå av inpassningen för att se
                skillnaden.
              </p>
            </div>
            <ComparePreview />
          </section>
        </div>
      </Page>
    </div>
  );
}
