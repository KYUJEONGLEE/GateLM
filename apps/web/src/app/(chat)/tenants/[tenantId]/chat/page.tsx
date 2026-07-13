import { redirect } from "next/navigation";
import { getChatUrl } from "@/lib/application/application-origin";

export default function CustomerDemoPage() {
  redirect(getChatUrl("/"));
}
