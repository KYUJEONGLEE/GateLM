"use client";

import { Building2, Calendar, Layers3, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
  allowTenantChat?: boolean;
  filters: DashboardFilterState;
  locale: Locale;
  projects: ProjectRecord[];
  refreshHref: string;
  refreshLabel: string;
  rangeOptions: DashboardRangeOption[];
};

export function DashboardFilterForm({
  actionPath,
  allowAllProjects = true,
  allowTenantChat = true,
  filters,
  locale,
  projects,
  refreshHref,
  refreshLabel,
  rangeOptions
}: DashboardFilterFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [draftFilters, setDraftFilters] = useState(() => ({
    projectId: filters.projectId,
    range: filters.range,
    surface: filters.surface
  }));

  function navigateToFilters(nextFilters: typeof draftFilters) {
    setDraftFilters(nextFilters);

    const query = new URLSearchParams();

    setQueryParam(query, "range", nextFilters.range);
    setQueryParam(query, "surface", nextFilters.surface);
    setQueryParam(query, "projectId", nextFilters.projectId);
    setQueryParam(query, "budgetScopeType", filters.budgetScopeType);
    setQueryParam(query, "budgetScopeId", filters.budgetScopeId);
    setQueryParam(query, "resolvedBy", filters.resolvedBy);
    setQueryParam(query, "motion", "none");

    const queryString = query.toString();
    const href = queryString ? `${actionPath}?${queryString}` : actionPath;

    startTransition(() => {
      router.replace(href, { scroll: false });
    });
  }

  function updateRange(range: DashboardRange) {
    navigateToFilters({ ...draftFilters, range });
  }

  function updateSurface(surface: DashboardFilterState["surface"]) {
    navigateToFilters({
      ...draftFilters,
      projectId: surface === "project_application" ? draftFilters.projectId : "",
      surface
    });
  }

  function updateProject(projectId: string) {
    navigateToFilters({ ...draftFilters, projectId });
  }

  return (
    <div aria-busy={isPending} className="dashboard-summary-form">
      <label>
        <span>{locale === "ko" ? "시간 범위" : "Time range"}</span>
        <div className="dashboard-filter-input">
          <Calendar aria-hidden="true" size={16} strokeWidth={2.1} />
          <select
            name="range"
            onChange={(event) => updateRange(event.target.value as DashboardRange)}
            value={draftFilters.range}
          >
            {rangeOptions.map((range) => (
              <option key={range.value} value={range.value}>
                {range.label}
              </option>
            ))}
          </select>
        </div>
      </label>
      <label>
        <span>{locale === "ko" ? "사용 범위" : "Usage source"}</span>
        <div className="dashboard-filter-input">
          <Layers3 aria-hidden="true" size={16} strokeWidth={2.1} />
          <select
            name="surface"
            onChange={(event) =>
              updateSurface(event.target.value as DashboardFilterState["surface"])
            }
            value={draftFilters.surface}
          >
            {allowTenantChat ? (
              <option value="all">{locale === "ko" ? "전체 사용량" : "All usage"}</option>
            ) : null}
            <option value="project_application">
              {locale === "ko" ? "프로젝트 / 앱" : "Projects / Apps"}
            </option>
            {allowTenantChat ? (
              <option value="tenant_chat">{locale === "ko" ? "테넌트 채팅" : "Tenant Chat"}</option>
            ) : null}
          </select>
        </div>
      </label>
      <label>
        <span>{locale === "ko" ? "프로젝트" : "Project"}</span>
        <div className="dashboard-filter-input">
          <Building2 aria-hidden="true" size={16} strokeWidth={2.1} />
          <select
            disabled={draftFilters.surface === "tenant_chat"}
            name="projectId"
            onChange={(event) => updateProject(event.target.value)}
            value={draftFilters.projectId}
          >
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
      <div className="dashboard-summary-actions">
        <Link aria-label={refreshLabel} className="dashboard-refresh-link" href={refreshHref}>
          <RotateCcw aria-hidden="true" size={18} strokeWidth={2.3} />
        </Link>
      </div>
    </div>
  );
}

function setQueryParam(query: URLSearchParams, key: string, value: string | null) {
  const normalizedValue = value?.trim() ?? "";

  if (normalizedValue === "") {
    query.delete(key);
    return;
  }

  query.set(key, normalizedValue);
}
