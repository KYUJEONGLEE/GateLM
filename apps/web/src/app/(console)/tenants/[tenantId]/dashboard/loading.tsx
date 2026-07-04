import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="console-main">
      <main className="console-content" data-motion="none">
        <section className="dashboard-hero">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-9 w-48" />
          </div>
          <Skeleton className="h-9 w-36 rounded-md" />
        </section>

        <div className="metric-grid">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton className="h-28 rounded-lg" key={index} />
          ))}
        </div>

        <section className="dashboard-chart-grid">
          <Skeleton className="h-[390px] rounded-lg" />
          <Skeleton className="h-[390px] rounded-lg" />
        </section>
      </main>
    </div>
  );
}
