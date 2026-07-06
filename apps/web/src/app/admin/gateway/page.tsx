import { redirect } from "next/navigation";

export default function GatewayAdminIndexPage() {
  redirect("/admin/gateway/overview");
}
