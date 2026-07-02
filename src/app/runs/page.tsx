import Link from "next/link";
import { getDashboardData } from "@/lib/dashboard-data";
import type { ScanRun } from "@/lib/types";

export const dynamic = "force-dynamic";

const numberFormat = new Intl.NumberFormat("de-DE");

export default async function RunsPage() {
  const data = await getDashboardData();

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-3 border-b border-line pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-accent-strong">Walkman Restoration Scout</p>
            <h1 className="mt-2 text-2xl font-semibold">Letzte Laeufe</h1>
          </div>
          <Link className="rounded-md border border-line bg-panel px-3 py-2 text-sm font-medium text-accent-strong hover:text-accent" href="/">
            Zurueck zum Dashboard
          </Link>
        </header>

        <section className="rounded-lg border border-line bg-panel p-4 shadow-sm">
          {data.runs.length ? (
            <div className="flex flex-col divide-y divide-line">
              {data.runs.map((run) => (
                <RunRow key={run.id} run={run} />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-line bg-panel-muted px-4 py-8 text-center text-sm text-foreground/60">
              Noch keine Scans gelaufen.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function RunRow({ run }: { run: ScanRun }) {
  return (
    <div className="grid gap-3 py-3 text-sm sm:grid-cols-[1fr_auto]">
      <div className="min-w-0">
        <div className="font-medium">{run.runType.replace(/_/g, " ")}</div>
        <div className="mt-1 text-xs text-foreground/55">
          {formatDate(run.startedAt)} - {run.errors.length} Fehler
        </div>
        {run.errors.length ? (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-medium text-accent-strong hover:text-accent">
              Fehler anzeigen
            </summary>
            <div className="mt-2 grid gap-1 text-xs text-foreground/65">
              {run.errors.slice(0, 20).map((error, index) => (
                <div key={`${error.scope}-${index}`} className="rounded bg-background px-2 py-1">
                  <span className="font-medium">{error.scope}:</span> {error.message}
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </div>
      <div className="font-mono text-xs sm:text-right">
        <div className={run.status === "completed" ? "text-positive" : run.status === "failed" ? "text-danger" : "text-warning"}>
          {run.status}
        </div>
        <div className="mt-1 text-foreground/55">
          {numberFormat.format(run.modelsSaved + run.salesSaved + run.marketListingsSaved + run.candidatesSaved)} saved
        </div>
      </div>
    </div>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}
