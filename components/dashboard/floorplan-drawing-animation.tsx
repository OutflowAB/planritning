"use client";

/**
 * A floor plan that draws itself, in the house style, on a loop.
 *
 * Purely decorative. It claims nothing about progress — the only real figure on the
 * processing screen is elapsed time. The timeline runs walls, then windows, then door swings,
 * then fixtures, then labels, then a sweep of light across the finished plan before it clears
 * and starts over.
 */

const LOOP_SECONDS = 7;

const INK = "#3d3a36";
const BEIGE = "#e1d5c9";
const ACCENT = "#8b7355";

export function FloorplanDrawingAnimation() {
  return (
    <div className="w-full max-w-[320px]" aria-hidden="true">
      <style>{`
        @keyframes sm-fp-stroke {
          0%   { stroke-dashoffset: 1; opacity: 0; }
          2%   { opacity: 1; }
          18%  { stroke-dashoffset: 0; opacity: 1; }
          88%  { stroke-dashoffset: 0; opacity: 1; }
          100% { stroke-dashoffset: 0; opacity: 0; }
        }
        @keyframes sm-fp-fade {
          0%, 8%  { opacity: 0; }
          22%     { opacity: 1; }
          88%     { opacity: 1; }
          100%    { opacity: 0; }
        }
        @keyframes sm-fp-fill {
          0%   { opacity: 0; }
          30%  { opacity: 0; }
          55%  { opacity: 1; }
          88%  { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes sm-fp-sweep {
          0%, 55%  { transform: translateX(-120%); }
          80%      { transform: translateX(120%); }
          100%     { transform: translateX(120%); }
        }
        @keyframes sm-fp-grid {
          0%, 100% { opacity: 0.25; }
          50%      { opacity: 0.5; }
        }

        .sm-fp-line {
          stroke-dasharray: 1;
          stroke-dashoffset: 1;
          animation: sm-fp-stroke ${LOOP_SECONDS}s ease-in-out infinite;
        }
        .sm-fp-soft {
          opacity: 0;
          animation: sm-fp-fade ${LOOP_SECONDS}s ease-in-out infinite;
        }
        .sm-fp-fill {
          opacity: 0;
          animation: sm-fp-fill ${LOOP_SECONDS}s ease-in-out infinite;
        }
        .sm-fp-sweep {
          animation: sm-fp-sweep ${LOOP_SECONDS}s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }
        .sm-fp-grid {
          animation: sm-fp-grid ${LOOP_SECONDS}s ease-in-out infinite;
        }

        @media (prefers-reduced-motion: reduce) {
          .sm-fp-line, .sm-fp-soft, .sm-fp-fill, .sm-fp-sweep, .sm-fp-grid {
            animation: none;
            opacity: 1;
            stroke-dashoffset: 0;
            transform: none;
          }
        }
      `}</style>

      <svg viewBox="0 0 220 165" fill="none" className="h-auto w-full">
        <defs>
          <pattern id="sm-fp-grid-pattern" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M10 0 H0 V10" stroke={ACCENT} strokeWidth="0.3" fill="none" />
          </pattern>
          <linearGradient id="sm-fp-sweep-gradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="50%" stopColor="#ffffff" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          <clipPath id="sm-fp-plan-clip">
            <rect x="8" y="8" width="204" height="134" />
          </clipPath>
        </defs>

        {/* Rutnät i bakgrunden */}
        <rect
          className="sm-fp-grid"
          x="8"
          y="8"
          width="204"
          height="134"
          fill="url(#sm-fp-grid-pattern)"
        />

        {/* Rummen fylls med husets beige när planen är klar */}
        <g className="sm-fp-fill" fill={BEIGE}>
          <rect x="12" y="12" width="104" height="74" />
          <rect x="124" y="12" width="84" height="74" />
          <rect x="12" y="94" width="144" height="44" />
          <rect x="164" y="94" width="44" height="44" />
        </g>

        {/* Ytterväggar */}
        <g stroke={INK} strokeWidth="5" strokeLinecap="square" strokeLinejoin="miter">
          <path className="sm-fp-line" pathLength={1} d="M10 10 H210" style={{ animationDelay: "0s" }} />
          <path className="sm-fp-line" pathLength={1} d="M210 10 V140" style={{ animationDelay: "0.25s" }} />
          <path className="sm-fp-line" pathLength={1} d="M210 140 H10" style={{ animationDelay: "0.5s" }} />
          <path className="sm-fp-line" pathLength={1} d="M10 140 V10" style={{ animationDelay: "0.75s" }} />
        </g>

        {/* Innerväggar */}
        <g stroke={INK} strokeWidth="3.5" strokeLinecap="square">
          <path className="sm-fp-line" pathLength={1} d="M120 10 V60" style={{ animationDelay: "1.0s" }} />
          <path className="sm-fp-line" pathLength={1} d="M120 76 V90" style={{ animationDelay: "1.1s" }} />
          <path className="sm-fp-line" pathLength={1} d="M10 90 H72" style={{ animationDelay: "1.2s" }} />
          <path className="sm-fp-line" pathLength={1} d="M96 90 H210" style={{ animationDelay: "1.3s" }} />
          <path className="sm-fp-line" pathLength={1} d="M160 90 V140" style={{ animationDelay: "1.45s" }} />
        </g>

        {/* Fönster: vita segment infällda i väggen */}
        <g stroke="#ffffff" strokeWidth="5" strokeLinecap="butt">
          <path className="sm-fp-line" pathLength={1} d="M40 10 H76" style={{ animationDelay: "1.7s" }} />
          <path className="sm-fp-line" pathLength={1} d="M148 10 H184" style={{ animationDelay: "1.8s" }} />
          <path className="sm-fp-line" pathLength={1} d="M210 104 V128" style={{ animationDelay: "1.9s" }} />
        </g>

        {/* Dörrsvep */}
        <g stroke={ACCENT} strokeWidth="1.6" strokeLinecap="round">
          <path className="sm-fp-line" pathLength={1} d="M84 90 A24 24 0 0 1 84 66" style={{ animationDelay: "2.1s" }} />
          <path className="sm-fp-line" pathLength={1} d="M120 68 A16 16 0 0 0 136 68" style={{ animationDelay: "2.25s" }} />
        </g>

        {/* Fast inredning */}
        <g stroke={INK} strokeWidth="1.4" fill="none">
          {/* Köksbänk med diskho */}
          <path className="sm-fp-line" pathLength={1} d="M128 16 H204 V34 H128 Z" style={{ animationDelay: "2.5s" }} />
          <path className="sm-fp-line" pathLength={1} d="M136 20 H152 V30 H136 Z" style={{ animationDelay: "2.65s" }} />
          {/* Spis */}
          <circle className="sm-fp-line" pathLength={1} cx="172" cy="25" r="5.5" style={{ animationDelay: "2.75s" }} />
          {/* Badkar */}
          <path
            className="sm-fp-line"
            pathLength={1}
            d="M168 100 H204 V126 H168 Z"
            style={{ animationDelay: "2.9s" }}
          />
          {/* Trappa */}
          <g style={{ animationDelay: "3.05s" }}>
            <path className="sm-fp-line" pathLength={1} d="M18 98 H58 V132 H18 Z" style={{ animationDelay: "3.05s" }} />
            <path className="sm-fp-line" pathLength={1} d="M18 107 H58 M18 116 H58 M18 125 H58" style={{ animationDelay: "3.2s" }} />
          </g>
        </g>

        {/* Förkortningsrutor */}
        <g stroke={INK} strokeWidth="1.2" fill="none">
          <path className="sm-fp-line" pathLength={1} d="M186 40 H204 V56 H186 Z" style={{ animationDelay: "3.3s" }} />
        </g>
        <text
          className="sm-fp-soft"
          x="195"
          y="51"
          textAnchor="middle"
          fontSize="7"
          fontWeight="700"
          fill={INK}
          style={{ animationDelay: "3.4s" }}
        >
          DM
        </text>

        {/* Rumsetiketter */}
        <g fontSize="8" fontWeight="700" fill={INK} textAnchor="middle">
          <text className="sm-fp-soft" x="64" y="52" style={{ animationDelay: "3.5s" }}>
            VARDAGSRUM
          </text>
          <text className="sm-fp-soft" x="166" y="70" style={{ animationDelay: "3.65s" }}>
            KÖK
          </text>
          <text className="sm-fp-soft" x="108" y="120" style={{ animationDelay: "3.8s" }}>
            SOVRUM
          </text>
          <text className="sm-fp-soft" x="186" y="136" style={{ animationDelay: "3.95s" }}>
            BAD
          </text>
        </g>

        {/* Ljussvep över den färdiga planen */}
        <g clipPath="url(#sm-fp-plan-clip)">
          <rect
            className="sm-fp-sweep"
            x="8"
            y="8"
            width="70"
            height="134"
            fill="url(#sm-fp-sweep-gradient)"
          />
        </g>
      </svg>
    </div>
  );
}
