"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import type {
  TenantCreateValues,
  TenantRecord,
  TenantsModel
} from "@/lib/control-plane/tenants-types";
import { formatDateTime } from "@/lib/formatting/formatters";
import type { Locale } from "@/lib/i18n/locale";

type TenantManagementProps = {
  locale: Locale;
  model: TenantsModel;
};

type TenantResponsePayload = {
  error?: string;
  tenant?: TenantRecord;
};

type SubmitState = {
  message: string;
  status: "error" | "idle" | "success";
};

const tenantText: Record<
  Locale,
  {
    controlPlaneId: string;
    create: string;
    created: string;
    empty: string;
    fixtureFallback: string;
    management: string;
    name: string;
    namePlaceholder: string;
    saved: string;
    status: string;
    title: string;
    updated: string;
  }
> = {
  en: {
    controlPlaneId: "Control Plane tenant ID",
    create: "Create tenant",
    created: "Created",
    empty: "No tenants found.",
    fixtureFallback: "Control Plane unavailable. Showing current route tenant.",
    management: "management",
    name: "Name",
    namePlaceholder: "Acme Corp",
    saved: "Tenant created.",
    status: "Status",
    title: "Tenants",
    updated: "Updated"
  },
  ko: {
    controlPlaneId: "Control Plane tenant ID",
    create: "Tenant 생성",
    created: "생성",
    empty: "Tenant가 없습니다.",
    fixtureFallback: "Control Plane을 사용할 수 없어 현재 route tenant를 표시 중입니다.",
    management: "관리",
    name: "이름",
    namePlaceholder: "Acme Corp",
    saved: "Tenant가 생성되었습니다.",
    status: "상태",
    title: "Tenant",
    updated: "수정"
  }
};

export function TenantManagement({ locale, model }: TenantManagementProps) {
  const router = useRouter();
  const text = tenantText[locale];
  const [values, setValues] = useState<TenantCreateValues>({ name: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitState, setSubmitState] = useState<SubmitState>({
    message: "",
    status: "idle"
  });

  async function createTenant() {
    if (!values.name.trim()) {
      setSubmitState({
        message: locale === "ko" ? "Tenant 이름을 입력하세요." : "Tenant name is required.",
        status: "error"
      });
      return;
    }

    setIsSubmitting(true);
    setSubmitState({ message: "", status: "idle" });

    const response = await fetch("/api/control-plane/tenants", {
      body: JSON.stringify({
        action: "create",
        values
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const payload = (await response.json().catch(() => ({}))) as TenantResponsePayload;

    if (!response.ok || !payload.tenant) {
      setSubmitState({
        message: payload.error ?? "Tenant create failed.",
        status: "error"
      });
      setIsSubmitting(false);
      return;
    }

    setValues({ name: "" });
    setSubmitState({
      message: text.saved,
      status: "success"
    });
    setIsSubmitting(false);
    router.refresh();
  }

  return (
    <main className="console-content">
      <section className="dashboard-hero">
        <div>
          <p className="console-kicker">{text.management}</p>
          <h2>{text.title}</h2>
        </div>
      </section>

      {model.source === "fixture" ? (
        <p className="policy-alert" data-status="warning">
          {text.fixtureFallback} {model.loadError}
        </p>
      ) : null}

      <section className="console-panel">
        <div className="panel-heading">
          <h3>{text.create}</h3>
        </div>
        <div className="tenant-create-form">
          <label className="policy-field">
            <span>{text.name}</span>
            <input
              onChange={(event) => setValues({ name: event.target.value })}
              placeholder={text.namePlaceholder}
              value={values.name}
            />
          </label>
          <button
            className="primary-button"
            disabled={isSubmitting || !values.name.trim()}
            onClick={createTenant}
            type="button"
          >
            <Plus aria-hidden="true" />
            {text.create}
          </button>
        </div>
        {submitState.status !== "idle" ? (
          <p className="form-status" data-status={submitState.status}>
            {submitState.message}
          </p>
        ) : null}
      </section>

      <section className="console-panel">
        <div className="panel-heading">
          <h3>{text.title}</h3>
        </div>
        {model.tenants.length === 0 ? (
          <p className="project-empty">{text.empty}</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table project-table">
              <thead>
                <tr>
                  <th>{text.name}</th>
                  <th>{text.controlPlaneId}</th>
                  <th>{text.status}</th>
                  <th>{text.updated}</th>
                </tr>
              </thead>
              <tbody>
                {model.tenants.map((tenant) => (
                  <tr key={tenant.id}>
                    <td>
                      <strong className="provider-name">{tenant.name}</strong>
                    </td>
                    <td>
                      <code className="project-code">{tenant.id}</code>
                    </td>
                    <td>
                      <Badge
                        className="project-status-badge"
                        data-status={tenant.status}
                        variant="outline"
                      >
                        {tenant.status}
                      </Badge>
                    </td>
                    <td>
                      <span className="project-muted">{formatDateTime(tenant.updatedAt)}</span>
                      <small className="project-muted">
                        {text.created}: {formatDateTime(tenant.createdAt)}
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
