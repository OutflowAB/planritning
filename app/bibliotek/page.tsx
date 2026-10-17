import { redirect } from "next/navigation";

/** The old library address; finished plans now live under Planritningar. */
export default function BibliotekPage() {
  redirect("/planritningar");
}
