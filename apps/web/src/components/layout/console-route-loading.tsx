import { Skeleton } from "@/components/ui/skeleton";

type ConsoleRouteLoadingVariant = "dashboard" | "management" | "table";

type ConsoleRouteLoadingProps = {
  variant?: ConsoleRouteLoadingVariant;
};

export function ConsoleRouteLoading({ variant = "management" }: ConsoleRouteLoadingProps) {
  return (
    <main className="console-content" data-motion="none">
      <section className="dashboard-hero">
        <div className="flex min-w-0 flex-col gap-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-9 w-52 max-w-full" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-9 w-36 shrink-0 rounded-md" />
      </section>

      {variant === "dashboard" ? <DashboardLoadingBody /> : null}
      {variant === "table" ? <TableLoadingBody /> : null}
      {variant === "management" ? <ManagementLoadingBody /> : null}
    </main>
  );
}

function DashboardLoadingBody() {
  return (
    <>
      <div className="metric-grid">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton className="h-28 rounded-lg" key={index} />
        ))}
      </div>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.42fr)]">
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-[360px] rounded-lg" />
          <Skeleton className="h-[360px] rounded-lg" />
        </div>
        <Skeleton className="h-[360px] rounded-lg" />
      </section>
    </>
  );
}

function ManagementLoadingBody() {
  return (
    <section className="grid gap-4 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <Skeleton className="h-44 rounded-lg" key={index} />
      ))}
    </section>
  );
}

function TableLoadingBody() {
  return (
    <section className="console-panel grid gap-4">
      <div className="grid gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton className="h-20 rounded-lg" key={index} />
        ))}
      </div>
      <Skeleton className="h-12 rounded-lg" />
      <div className="grid gap-2">
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton className="h-11 rounded-md" key={index} />
        ))}
      </div>
    </section>
  );
}
