/**
 * Who the panel says it belongs to. The product is the same for every customer; the tenant is
 * the brokerage the panel is set up for. There is one tenant for now, so it is a constant. Once
 * there are several it moves to the database and is looked up from the signed-in user, and
 * nothing that reads it here needs to change shape.
 *
 * This is the interface only. The logo and colours drawn onto the generated sheets still come
 * from lib/image/brand-floorplan.ts and lib/sm-floorplan-layout.ts.
 */

export type Tenant = {
  name: string;
  /** A one-colour logo in public/. Drawn as-is on light surfaces, inverted to white on dark. */
  logoSrc: string;
  logoWidth: number;
  logoHeight: number;
  /** The customer's colour: active navigation, selections, focus rings. Must read on white. */
  accent: string;
};

/** Working name, pending the partners' sign-off. */
export const PRODUCT_NAME = "Redraw";

export const TENANT: Tenant = {
  name: "SkandiaMäklarna",
  logoSrc: "/sm-logo.svg",
  logoWidth: 2236,
  logoHeight: 437,
  accent: "#8b7355",
};
