"use client";

import dynamic from "next/dynamic";
import type { ApiKeysModel } from "@/lib/control-plane/api-keys-types";
import type { ProjectAdminsModel } from "@/lib/control-plane/project-admins-types";
import type { ProjectRecord } from "@/lib/control-plane/projects-types";
import type { ProjectTeamsModel } from "@/lib/control-plane/teams-types";
import type { Locale } from "@/lib/i18n/locale";
import { RuntimePolicyMovedBudgetSlot } from "./runtime-policy-editor";

type ProjectPolicyGeneralContentProps = {
  locale: Locale;
  project: ProjectRecord;
  projectAdminsModel: ProjectAdminsModel;
  projectApiKeysModel: ApiKeysModel;
  projectTeamsModel: ProjectTeamsModel;
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

type ProjectTeamAssignmentSectionProps = {
  locale: Locale;
  model: ProjectTeamsModel;
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

const ProjectTeamAssignmentSection = dynamic<ProjectTeamAssignmentSectionProps>(
  () =>
    import("@/features/teams/components/team-management").then(
      (module) => module.ProjectTeamAssignmentSection
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
  projectTeamsModel,
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
        <ProjectTeamAssignmentSection locale={locale} model={projectTeamsModel} />
        <ProjectGatewayApiKeyPanel locale={locale} model={projectApiKeysModel} />
        <ProjectDeleteSection locale={locale} project={project} tenantId={tenantId} />
      </div>
    </>
  );
}
