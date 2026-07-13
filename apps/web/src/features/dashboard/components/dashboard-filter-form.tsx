"use client";

import { Building2, Calendar } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useTransition } from "react";
import type {
  DashboardFilterState,
  DashboardRange
} from "@/features/dashboard/components/dashboard-overview";
import type { ProjectRecord } from "@/lib/control-plane/projects-types";
import type { Locale } from "@/lib/i18n/locale";

type DashboardRangeOption = {
  label: string;
  value: DashboardRange;
};

type DashboardFilterFormProps = {
  actionPath: string;
  allowAllProjects?: boolean;
  applyLabel: string;
  filters: DashboardFilterState;
  locale: Locale;
  projects: ProjectRecord[];
  rangeOptions: DashboardRangeOption[];
};

export function DashboardFilterForm({
  actionPath,
  allowAllProjects = true,
  applyLabel,
  filters,
  locale,
  projects,
  rangeOptions
}: DashboardFilterFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const query = new URLSearchParams();

    setQueryParam(query, "range", formData.get("range"));
    setQueryParam(query, "projectId", formData.get("projectId"));
    setQueryParam(query, "budgetScopeType", formData.get("budgetScopeType"));
    setQueryParam(query, "budgetScopeId", formData.get("budgetScopeId"));
    setQueryParam(query, "resolvedBy", formData.get("resolvedBy"));
    setQueryParam(query, "motion", "none");

    const queryString = query.toString();
    const href = queryString ? `${actionPath}?${queryString}` : actionPath;

    startTransition(() => {
      router.replace(href, { scroll: false });
    });
  }

  return (
    <form className="dashboard-summary-form" onSubmit={handleSubmit}>
      <label>
        <span>{locale === "ko" ? "시간 범위" : "Time range"}</span>
        <div className="dashboard-filter-input">
          <Calendar aria-hidden="true" size={16} strokeWidth={2.1} />
          <select defaultValue={filters.range} name="range">
            {rangeOptions.map((range) => (
              <option key={range.value} value={range.value}>
                {range.label}
              </option>
            ))}
          </select>
        </div>
      </label>
      <label>
        <span>{locale === "ko" ? "프로젝트" : "Project"}</span>
        <div className="dashboard-filter-input">
          <Building2 aria-hidden="true" size={16} strokeWidth={2.1} />
          <select defaultValue={filters.projectId} name="projectId">
            {allowAllProjects ? (
              <option value="">{locale === "ko" ? "전체 프로젝트" : "All projects"}</option>
            ) : null}
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
      </label>
      <input name="budgetScopeType" type="hidden" value={filters.budgetScopeType} />
      <input name="budgetScopeId" type="hidden" value={filters.budgetScopeId} />
      <input name="resolvedBy" type="hidden" value={filters.resolvedBy} />
      <button className="secondary-button" disabled={isPending} type="submit">
        {applyLabel}
      </button>
    </form>
  );
}

function setQueryParam(query: URLSearchParams, key: string, value: FormDataEntryValue | string | null) {
  const normalizedValue = typeof value === "string" ? value.trim() : "";

  if (normalizedValue === "") {
    query.delete(key);
    return;
  }

  query.set(key, normalizedValue);
}
