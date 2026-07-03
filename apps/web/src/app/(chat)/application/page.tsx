import { redirect } from "next/navigation";
import { getApplicationUrl } from "@/lib/application/application-origin";

export default function ApplicationPage() {
  redirect(getApplicationUrl("/"));
}
