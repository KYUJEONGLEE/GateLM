"use client";

import dynamic from "next/dynamic";
import type { EmployeeControlModel } from "@/lib/control-plane/employees-types";
import type { ProjectRecord } from "@/lib/control-plane/projects-types";
import type { ProviderConnectionRecord } from "@/lib/control-plane/provider-connections-types";
import type { Locale } from "@/lib/i18n/locale";

type ProjectPolicyEmployeeContentProps = {
  locale: Locale;
  model: EmployeeControlModel;
  project: ProjectRecord;
  providerConnections: ProviderConnectionRecord[];
};

const ProjectEmployeeAssignmentSection = dynamic<ProjectPolicyEmployeeContentProps>(
  () =>
    import("@/features/employees/components/employee-control-management").then(
      (module) => module.ProjectEmployeeAssignmentSection
    ),
  {
    loading: () => null,
    ssr: false
  }
);

export function ProjectPolicyEmployeeContent({
  locale,
  model,
  project,
  providerConnections
}: ProjectPolicyEmployeeContentProps) {
  return (
    <ProjectEmployeeAssignmentSection
      locale={locale}
      model={model}
      project={project}
      providerConnections={providerConnections}
    />
  );
}
