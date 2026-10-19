import { DraftingCompass, PencilRuler, type LucideIcon } from "lucide-react";
import { ReactNode } from "react";

/**
 * Redraw's mark, and the pen-themed alternatives still being weighed. Marks draw in
 * `currentColor`; tiled marks draw their inner lines in `--mark-ink` (white unless set), so
 * every mark works on light and on dark. `ProductMark` is the one the app shows; the preview
 * page lays out all of them.
 */

type MarkProps = { className?: string };

const INK = "var(--mark-ink, #fff)";
/**
 * Redraw's signature colour: the line the pen leaves. Outflow's own orange (its site's
 * `--brand-accent`, rgb 255 122 73), so the product reads as Outflow's.
 */
export const PRODUCT_SIGNAL = "#ff7a49";
const SIGNAL_DEEP = "#e8572a";

const NIB_PATH = "M12 6.5 H20 L22.5 13.5 L16 23 L9.5 13.5 Z";

/** "Pennan": a fountain-pen nib in a tile, drawing a line. */
export function PenMark({ className = "" }: MarkProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
      <rect width="32" height="32" rx="8" fill="currentColor" />
      <path d="M8 24.6 H16" stroke={PRODUCT_SIGNAL} strokeWidth="2.4" strokeLinecap="round" />
      <path d={NIB_PATH} fill={INK} strokeLinejoin="round" />
      <path d="M16 14.5 V22.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="16" cy="13.5" r="1.7" fill="currentColor" />
    </svg>
  );
}

/** "Linjeritning": the nib as fine line art, no tile — editorial and light. */
export function OutlinePenMark({ className = "" }: MarkProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
      <path d="M11 5 H21 L24 13.5 L16 26 L8 13.5 Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M9.6 9.5 H22.4" stroke="currentColor" strokeWidth="1.2" />
      <path d="M16 16.5 V25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="16" cy="14.5" r="2" fill={PRODUCT_SIGNAL} />
    </svg>
  );
}

/** "Stämpeln": an architect's seal — name around the rim, the nib in the middle. */
export function SealMark({ className = "" }: MarkProps) {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" className={className}>
      <defs>
        <path id="redraw-seal-text" d="M32 32 m0 -23.5 a23.5 23.5 0 1 1 0 47 a23.5 23.5 0 1 1 0 -47" />
      </defs>
      <circle cx="32" cy="32" r="30" stroke="currentColor" strokeWidth="2" />
      <circle cx="32" cy="32" r="17.5" stroke="currentColor" strokeWidth="1" />
      <text fill="currentColor" fontSize="6" fontWeight="600" fontFamily="var(--font-geist), system-ui, sans-serif">
        {/* Stretched to exactly one turn, so the rim reads evenly with no seam. */}
        <textPath href="#redraw-seal-text" textLength="146" lengthAdjust="spacing">
          REDRAW • PLANRITNINGAR • REDRAW • PLANRITNINGAR •
        </textPath>
      </text>
      <g transform="translate(16 15.5)">
        <path d={NIB_PATH} fill="currentColor" />
        <path d="M16 14.5 V22.5" stroke={PRODUCT_SIGNAL} strokeWidth="1.3" strokeLinecap="round" />
        <circle cx="16" cy="13.5" r="1.7" fill={PRODUCT_SIGNAL} />
      </g>
    </svg>
  );
}

/** "Blyertsen": a pencil mid-stroke, flat and friendly. */
export function PencilMark({ className = "" }: MarkProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
      <path d="M3.5 27.5 H15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.35" />
      <g transform="rotate(-45 16 16)">
        <rect x="9" y="12.5" width="14" height="7" fill={PRODUCT_SIGNAL} />
        <rect x="9" y="12.5" width="14" height="2.3" fill={SIGNAL_DEEP} opacity="0.35" />
        <rect x="23" y="12.5" width="2.6" height="7" fill="currentColor" opacity="0.55" />
        <rect x="25.6" y="12.5" width="3.4" height="7" rx="1.4" fill="currentColor" />
        <path d="M9 12.5 V19.5 L3 16 Z" fill="#ffd9c7" />
        <path d="M5 14.8 V17.2 L3 16 Z" fill="currentColor" />
      </g>
    </svg>
  );
}

/** "Solnedgången": a warm gradient app icon with a white nib — bold on a home screen. */
export function GradientPenMark({ className = "" }: MarkProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id="redraw-sunset" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ff9d72" />
          <stop offset="100%" stopColor={SIGNAL_DEEP} />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#redraw-sunset)" />
      <path d={NIB_PATH} fill="#ffffff" />
      <path d="M16 14.5 V22.5" stroke="#f26a3a" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="16" cy="13.5" r="1.7" fill="#f26a3a" />
      <path d="M8 26 H24" stroke="#ffffff" strokeWidth="1.6" strokeLinecap="round" opacity="0.55" />
    </svg>
  );
}

/** "Negativet": a solid disc with the nib cut out of it. */
export function CutoutPenMark({ className = "" }: MarkProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
      <defs>
        <mask id="redraw-cutout">
          <rect width="32" height="32" fill="#fff" />
          <path d="M12.3 7.8 H19.7 L22 14.2 L16 23.6 L10 14.2 Z" fill="#000" />
          <path d="M16 15 V23" stroke="#fff" strokeWidth="1.3" />
          <circle cx="16" cy="14.2" r="1.6" fill="#fff" />
        </mask>
      </defs>
      <circle cx="16" cy="16" r="14" fill={PRODUCT_SIGNAL} mask="url(#redraw-cutout)" />
    </svg>
  );
}

/** "Linjen": one stroke that draws a roof and a wall, finished by the pen that drew it. */
export function LinePenMark({ className = "" }: MarkProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
      <path
        d="M2.5 27 H7.5 V17.5 L13.5 12 L19.5 17.5 V22"
        stroke={PRODUCT_SIGNAL}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* The pen, held at a writing angle, its point on the end of the line. */}
      <g transform="translate(19.5 22) rotate(32) scale(0.72) translate(-16 -23)">
        <path d={NIB_PATH} fill="currentColor" />
        <circle cx="16" cy="13.5" r="1.8" fill={PRODUCT_SIGNAL} />
      </g>
    </svg>
  );
}

/** "Signaturen", icon form: a lowercase r over the pen's underline. */
export function SignatureMark({ className = "" }: MarkProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
      <path d="M11 9.5 V21.5" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M11 15 C11 11.5 13.5 9.5 17.5 9.5" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M5 26 C11 24 17 24.5 26.5 24" stroke={PRODUCT_SIGNAL} strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

/** "Signaturen", full: the word, underlined by the pen as if just written. */
export function SignatureWordmark({ className = "" }: MarkProps) {
  return (
    <svg viewBox="0 0 118 36" fill="none" aria-hidden="true" className={className}>
      <text
        x="2"
        y="22"
        fill="currentColor"
        fontSize="24"
        fontWeight="650"
        letterSpacing="-0.9"
        fontFamily="var(--font-geist), system-ui, sans-serif"
      >
        redraw
      </text>
      <path d="M3 29.5 C30 27 62 28 98 26.5" stroke={PRODUCT_SIGNAL} strokeWidth="2.6" strokeLinecap="round" />
      <g transform="translate(98.5 26.3) rotate(38) scale(0.62) translate(-16 -23)">
        <path d={NIB_PATH} fill="currentColor" />
        <circle cx="16" cy="13.5" r="1.8" fill={PRODUCT_SIGNAL} />
      </g>
    </svg>
  );
}

/**
 * The "kollen" family style — Outflow's sites such as Hantverkskollen: a filled circle in the
 * brand colour with a white line icon from the same icon set (Lucide), the name beside it.
 * `circle: "currentColor"` makes a monochrome mark that follows the text colour.
 */
function kollenMark(Icon: LucideIcon, circle: string) {
  function KollenMark({ className = "" }: MarkProps) {
    const isMono = circle === "currentColor";
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-full ${className}`}
        style={{ background: isMono ? "currentColor" : circle }}
        aria-hidden="true"
      >
        <Icon className="h-[54%] w-[54%]" strokeWidth={1.9} style={{ color: isMono ? INK : "#ffffff" }} />
      </span>
    );
  }
  return KollenMark;
}

/** Circle mark and name, Hantverkskollen-style; the name follows the text colour or is orange. */
function kollenLockup(Mark: (props: MarkProps) => React.JSX.Element, orangeName: boolean) {
  function KollenLockup({ className = "" }: MarkProps) {
    return (
      <span className={`inline-flex items-center gap-2 ${className}`}>
        <Mark className="h-7 w-7" />
        <span
          className="text-[19px] font-semibold leading-none tracking-[-0.03em]"
          style={orangeName ? { color: PRODUCT_SIGNAL } : undefined}
        >
          Redraw
        </span>
      </span>
    );
  }
  return KollenLockup;
}

export const KollenCompassMark = kollenMark(DraftingCompass, PRODUCT_SIGNAL);
export const KollenPencilRulerMark = kollenMark(PencilRuler, PRODUCT_SIGNAL);

/*
 * The orange-disc family: one clear white drawing tool or plan symbol on Outflow's orange,
 * as line art or cut out of the disc. Readable down to favicon size.
 */

/** The compass legs, hinge and the arc it is drawing, in sheet units on a 32 grid. */
function CompassShapes({ ink }: { ink: string }) {
  return (
    <g stroke={ink} strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 5 V6.6" strokeWidth="2" />
      <circle cx="16" cy="8.7" r="2" strokeWidth="1.8" />
      <path d="M14.9 10.5 L10.4 22.3" strokeWidth="2.1" />
      <path d="M17.1 10.5 L21.6 22.3" strokeWidth="2.1" />
      <path d="M12.6 16.9 Q16 18.6 19.4 16.9" strokeWidth="1.4" />
      <path d="M8.6 23.4 Q16 28.2 23.4 23.4" strokeWidth="1.5" />
    </g>
  );
}

/** "Passaren, egen": our own compass, drawing an arc. */
export function CompassMark({ className = "" }: MarkProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
      <circle cx="16" cy="16" r="16" fill={PRODUCT_SIGNAL} />
      <CompassShapes ink="#ffffff" />
    </svg>
  );
}

/** "Passaren, urskuren": the same compass cut out of the disc. */
export function CompassCutoutMark({ className = "" }: MarkProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
      <defs>
        <mask id="redraw-compass-cut">
          <rect width="32" height="32" fill="#fff" />
          <CompassShapes ink="#000" />
        </mask>
      </defs>
      <circle cx="16" cy="16" r="16" fill={PRODUCT_SIGNAL} mask="url(#redraw-compass-cut)" />
    </svg>
  );
}

/** "Vinkelhaken": the architect's set square. */
export function SetSquareMark({ className = "" }: MarkProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
      <circle cx="16" cy="16" r="16" fill={PRODUCT_SIGNAL} />
      <g stroke="#ffffff" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.5 8.5 V23.5 H24.5 Z" strokeWidth="2.1" />
        <path d="M12.8 15.6 V20.2 H17.4 Z" strokeWidth="1.5" />
        <path d="M9.5 12 H11.3 M9.5 15.5 H11.3 M9.5 19 H11.3" strokeWidth="1.2" />
      </g>
    </svg>
  );
}

/** "Nordpilen": the north needle from the plan sheets. */
export function NorthMark({ className = "" }: MarkProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
      <circle cx="16" cy="16" r="16" fill={PRODUCT_SIGNAL} />
      <circle cx="16" cy="16" r="10.5" stroke="#ffffff" strokeWidth="1.2" opacity="0.55" />
      <path d="M16 5.5 L19.6 16 H12.4 Z" fill="#ffffff" />
      <path d="M12.4 16 L16 26.5 L19.6 16" stroke="#ffffff" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/** "Dörrbågen": the floor plan's door — a wall, the leaf and its swing. */
export function DoorSwingMark({ className = "" }: MarkProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
      <circle cx="16" cy="16" r="16" fill={PRODUCT_SIGNAL} />
      <g stroke="#ffffff" strokeLinecap="round">
        <path d="M7 22.5 H11.5" strokeWidth="2.8" />
        <path d="M23.5 22.5 H25" strokeWidth="2.8" />
        <path d="M11.5 22.5 V11" strokeWidth="2" />
        <path d="M11.5 11 A11.5 11.5 0 0 1 23 22.5" strokeWidth="1.5" />
      </g>
    </svg>
  );
}

/*
 * Nods to the kollen family rather than copies of it: a circle and a pen, drawn our own way.
 */

/** "Cirkel": the orange circle, with our own nib in white line art. */
export function CircleNibMark({ className = "" }: MarkProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
      <circle cx="16" cy="16" r="16" fill={PRODUCT_SIGNAL} />
      <g stroke="#ffffff" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12.3 8.5 H19.7 L22 14.6 L16 24 L10 14.6 Z" strokeWidth="1.9" />
        <path d="M16 17.6 V23" strokeWidth="1.6" />
      </g>
      <circle cx="16" cy="15.4" r="1.7" fill="#ffffff" />
    </svg>
  );
}

/** "Den ritade cirkeln": the circle is a pen stroke, not quite closed, its pen still on it. */
export function DrawnCircleMark({ className = "" }: MarkProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
      <path
        d="M16.6 28.3 A12 12 0 1 1 25.8 20.6"
        stroke={PRODUCT_SIGNAL}
        strokeWidth="3"
        strokeLinecap="round"
      />
      <g transform="translate(25.8 20.6) rotate(15) scale(0.74) translate(-16 -23)">
        <path d={NIB_PATH} fill="currentColor" />
        <circle cx="16" cy="13.5" r="1.9" fill={PRODUCT_SIGNAL} />
      </g>
    </svg>
  );
}

/** "Spetsen bryter ut": a dark nib reaching out of the orange circle. */
export function BreakoutMark({ className = "" }: MarkProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
      <circle cx="13" cy="19" r="10.5" fill={PRODUCT_SIGNAL} />
      <g transform="translate(10.5 25) rotate(36) scale(1.2) translate(-16 -23)">
        <path d={NIB_PATH} fill="currentColor" />
        <path d="M16 14.5 V22.5" stroke={PRODUCT_SIGNAL} strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="16" cy="13.5" r="1.8" fill={PRODUCT_SIGNAL} />
      </g>
    </svg>
  );
}

/** "Ringen": a fine dark ring with an orange nib inside — two colours, restrained. */
export function RingMark({ className = "" }: MarkProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
      <circle cx="16" cy="16" r="14.4" stroke="currentColor" strokeWidth="2.2" />
      <g transform="translate(16 16.6) scale(0.78) translate(-16 -14.75)">
        <path d={NIB_PATH} fill={PRODUCT_SIGNAL} />
        <path d="M16 14.5 V22.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="16" cy="13.5" r="1.8" fill="currentColor" />
      </g>
    </svg>
  );
}

export type LogoOption = {
  id: string;
  name: string;
  description: string;
  Mark: (props: MarkProps) => React.JSX.Element;
  /** How the name is set beside the mark; a lockup replaces mark and name entirely. */
  wordmark: "Redraw" | "redraw";
  lockup?: (props: MarkProps) => ReactNode;
};

export const LOGO_OPTIONS: LogoOption[] = [
  {
    id: "compass",
    name: "Passaren, egen",
    description: "Vår egen passare som just ritar en båge. Samma stil som standardikonen, men med karaktär.",
    Mark: CompassMark,
    wordmark: "Redraw",
    lockup: kollenLockup(CompassMark, false),
  },
  {
    id: "compass-cutout",
    name: "Passaren, urskuren",
    description: "Passaren utskuren ur den orange cirkeln, som Negativet.",
    Mark: CompassCutoutMark,
    wordmark: "Redraw",
    lockup: kollenLockup(CompassCutoutMark, false),
  },
  {
    id: "set-square",
    name: "Vinkelhaken",
    description: "Arkitektens trekantslinjal med mätstreck. Exakt och teknisk.",
    Mark: SetSquareMark,
    wordmark: "Redraw",
    lockup: kollenLockup(SetSquareMark, false),
  },
  {
    id: "north",
    name: "Nordpilen",
    description: "Kompassnålen från planritningsbladen. Orientering, riktning, rätt väg.",
    Mark: NorthMark,
    wordmark: "Redraw",
    lockup: kollenLockup(NorthMark, false),
  },
  {
    id: "door",
    name: "Dörrbågen",
    description: "Planritningens dörrsymbol: en vägg, dörrbladet och slagbågen. Igenkännbar för varje mäklare.",
    Mark: DoorSwingMark,
    wordmark: "Redraw",
    lockup: kollenLockup(DoorSwingMark, false),
  },
  {
    id: "pencil-ruler",
    name: "Penna och linjal (standardikon)",
    description: "Lucides penna och linjal i cirkeln, som jämförelse med passaren.",
    Mark: KollenPencilRulerMark,
    wordmark: "Redraw",
    lockup: kollenLockup(KollenPencilRulerMark, false),
  },
  {
    id: "kollen-compass",
    name: "Passaren (standardikon)",
    description: "Som jämförelse: Lucides passare i cirkeln, exakt som Hantverkskollen bygger sin.",
    Mark: KollenCompassMark,
    wordmark: "Redraw",
    lockup: kollenLockup(KollenCompassMark, false),
  },
  {
    id: "cutout",
    name: "Negativet",
    description: "En orange cirkel där pennspetsen är urskuren. Grafisk och djärv.",
    Mark: CutoutPenMark,
    wordmark: "Redraw",
  },
  {
    id: "circle",
    name: "Cirkel",
    description: "Orange cirkel med vår egen pennspets i vit linjeteckning. Kollen-känslan, men egen.",
    Mark: CircleNibMark,
    wordmark: "Redraw",
    lockup: kollenLockup(CircleNibMark, false),
  },
  {
    id: "drawn-circle",
    name: "Den ritade cirkeln",
    description: "Cirkeln är ett penndrag som inte riktigt sluter sig, med pennan kvar på den. Redraw utan ord.",
    Mark: DrawnCircleMark,
    wordmark: "Redraw",
    lockup: kollenLockup(DrawnCircleMark, false),
  },
  {
    id: "breakout",
    name: "Spetsen bryter ut",
    description: "En mörk pennspets som sticker ut ur den orange cirkeln. Mer rörelse och självförtroende.",
    Mark: BreakoutMark,
    wordmark: "Redraw",
    lockup: kollenLockup(BreakoutMark, false),
  },
  {
    id: "ring",
    name: "Ringen",
    description: "En tunn svart ring med orange spets inuti. Stram och tvåfärgad.",
    Mark: RingMark,
    wordmark: "Redraw",
    lockup: kollenLockup(RingMark, false),
  },
  {
    id: "circle-orange-name",
    name: "Cirkel, orange ordbild",
    description: "Som Cirkel, men ordbilden också i orange, som Hantverkskollen är helt grön.",
    Mark: CircleNibMark,
    wordmark: "Redraw",
    lockup: kollenLockup(CircleNibMark, true),
  },
  {
    id: "pen",
    name: "Pennan",
    description: "Reservoarpennspetsen i en mörk ruta, som drar ett streck. Den som används nu.",
    Mark: PenMark,
    wordmark: "Redraw",
  },
  {
    id: "outline",
    name: "Linjeritning",
    description: "Spetsen som tunn linjeteckning utan ruta, med luftningshålet i orange. Lätt och redaktionell.",
    Mark: OutlinePenMark,
    wordmark: "Redraw",
  },
  {
    id: "seal",
    name: "Stämpeln",
    description: "Som en arkitektstämpel: namnet runt kanten, spetsen i mitten. Premium och hantverk.",
    Mark: SealMark,
    wordmark: "Redraw",
  },
  {
    id: "pencil",
    name: "Blyertsen",
    description: "En blyertspenna mitt i ett drag. Varm, vänlig och lekfull.",
    Mark: PencilMark,
    wordmark: "redraw",
  },
  {
    id: "sunset",
    name: "Solnedgången",
    description: "Appikon i en varm färgtoning med vit spets. Syns direkt på en hemskärm.",
    Mark: GradientPenMark,
    wordmark: "Redraw",
  },
  {
    id: "line",
    name: "Linjen",
    description: "Ett enda drag som ritar ett tak och en vägg, och pennan som just ritade det.",
    Mark: LinePenMark,
    wordmark: "Redraw",
  },
  {
    id: "signature",
    name: "Signaturen",
    description: "Ren ordbild, understruken av pennan som om den just skrivits. Ikonen är ett r över strecket.",
    Mark: SignatureMark,
    wordmark: "redraw",
    lockup: SignatureWordmark,
  },
];

/** The mark the app uses. */
export const ProductMark = PenMark;
