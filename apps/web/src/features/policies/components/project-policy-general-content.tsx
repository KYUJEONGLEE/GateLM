"use client";

import dynamic from "next/dynamic";
import type { ApiKeysModel } from "@/lib/control-plane/api-keys-types";
import type { EmployeeControlModel } from "@/lib/control-plane/employees-types";
import type { ProjectAdminsModel } from "@/lib/control-plane/project-admins-types";
import type { ProjectRecord } from "@/lib/control-plane/projects-types";
import type { Locale } from "@/lib/i18n/locale";
import { RuntimePolicyMovedBudgetSlot } from "./runtime-policy-editor";

type ProjectPolicyGeneralContentProps = {
  locale: Locale;
  project: ProjectRecord;
  projectAdminsModel: ProjectAdminsModel;
  projectApiKeysModel: ApiKeysModel;
  projectEmployeeModel: EmployeeControlModel;
  tenantId: string;
};

type ProjectDetailSectionProps = {
  locale: Locale;
  project: ProjectRecord;
  tenantId: string;
};

type ProjectAdminSectionProps = {
  locale: Locale;
  model: ProjectAdminsModel;
};

type ProjectEmployeeAssignmentSectionProps = {
  locale: Locale;
  model: EmployeeControlModel;
  project: ProjectRecord;
};

type ProjectGatewayApiKeyPanelProps = {
  locale: Locale;
  model: ApiKeysModel;
};

function LazySectionFallback() {
  return null;
}

const ProjectDetailSection = dynamic<ProjectDetailSectionProps>(
  () =>
    import("@/features/projects/components/project-management").then(
      (module) => module.ProjectDetailSection
    ),
  {
    loading: LazySectionFallback,
    ssr: false
  }
);

const ProjectAdminSection = dynamic<ProjectAdminSectionProps>(
  () =>
    import("@/features/project-admins/components/project-admin-management").then(
      (module) => module.ProjectAdminSection
    ),
  {
    loading: LazySectionFallback,
    ssr: false
  }
);

const ProjectEmployeeAssignmentSection = dynamic<ProjectEmployeeAssignmentSectionProps>(
  () =>
    import("@/features/employees/components/employee-control-management").then(
      (module) => module.ProjectEmployeeAssignmentSection
    ),
  {
    loading: LazySectionFallback,
    ssr: false
  }
);

const ProjectGatewayApiKeyPanel = dynamic<ProjectGatewayApiKeyPanelProps>(
  () =>
    import("@/features/projects/components/project-gateway-api-key-section").then(
      (module) => module.ProjectGatewayApiKeyPanel
    ),
  {
    loading: LazySectionFallback,
    ssr: false
  }
);

const ProjectDeleteSection = dynamic<ProjectDetailSectionProps>(
  () =>
    import("@/features/projects/components/project-management").then(
      (module) => module.ProjectDeleteSection
    ),
  {
    loading: LazySectionFallback,
    ssr: false
  }
);

export function ProjectPolicyGeneralContent({
  locale,
  project,
  projectAdminsModel,
  projectApiKeysModel,
  projectEmployeeModel,
  tenantId
}: ProjectPolicyGeneralContentProps) {
  return (
    <>
      <div className="project-policy-general-tab management-line-content">
        <ProjectDetailSection locale={locale} project={project} tenantId={tenantId} />
      </div>
      <RuntimePolicyMovedBudgetSlot />
      <div className="project-policy-general-tab management-line-content">
        <ProjectAdminSection locale={locale} model={projectAdminsModel} />
        <ProjectEmployeeAssignmentSection
          locale={locale}
          model={projectEmployeeModel}
          project={project}
        />
        <ProjectGatewayApiKeyPanel locale={locale} model={projectApiKeysModel} />
        <ProjectDeleteSection locale={locale} project={project} tenantId={tenantId} />
      </div>
    </>
  );
}
