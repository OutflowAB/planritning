import { redirect } from "next/navigation";

/** The old start page; the converter now lives under Konverterare. */
export default function StartsidaPage() {
  redirect("/konverterare");
}
