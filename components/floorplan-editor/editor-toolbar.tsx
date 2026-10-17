"use client";

import {
  AppWindow,
  ArrowLeft,
  DoorOpen,
  Eraser,
  LayoutGrid,
  MousePointer2,
  Minus,
  MoveHorizontal,
  Ruler,
  Trash2,
  Type,
} from "lucide-react";

import type { FloorplanEditorController } from "@/components/floorplan-editor/hooks/use-floorplan-editor";
import { flipDoorSide } from "@/lib/floorplan/door";
import { formatMeters, formatSquareMeters, lineLengthInMeters, totalRoomArea } from "@/lib/floorplan/measure";
import {
  abbreviationFontSize,
  FLOORPLAN_FURNITURE,
  FLOORPLAN_SYMBOLS,
  abbreviationTextSize,
} from "@/lib/floorplan/symbol-library";
import { SM_ROOM_LABEL_FONT, SM_ROOM_LABEL_WEIGHT } from "@/lib/sm-floorplan-layout";
import type { EditorTool } from "@/lib/floorplan/types";

type ToolDefinition = {
  id: EditorTool;
  label: string;
  icon: React.ReactNode;
  hint?: string;
};

const TOOLS: ToolDefinition[] = [
  { id: "select", label: "Markera", icon: <MousePointer2 size={18} /> },
  { id: "eraser", label: "Sudda", icon: <Eraser size={18} /> },
  { id: "wall", label: "Vägg", icon: <Minus size={18} />, hint: "Klicka start och slut, Shift för rak vägg, Esc för att sluta" },
  { id: "roomLabel", label: "Rum", icon: <Type size={18} /> },
  { id: "dimension", label: "Mått", icon: <Ruler size={18} />, hint: "Klicka start och slut" },
  { id: "door", label: "Dörr", icon: <DoorOpen size={18} /> },
  { id: "window", label: "Fönster", icon: <AppWindow size={18} /> },
  { id: "stair", label: "Trappa", icon: <MoveHorizontal size={18} /> },
  { id: "symbol", label: "Symbol", icon: <LayoutGrid size={18} /> },
];

/** Floor labels from the reference plans; any other label can be typed. */
const FLOOR_LABELS = ["ENTRÉPLAN", "PLAN 2", "PLAN 3", "ÖVERVÅNING", "SOUTERRÄNG", "KÄLLARE", "VIND"];

export type PlanMeta = { address: string; floorLabel: string };

type EditorToolbarProps = {
  controller: FloorplanEditorController;
  isLoading?: boolean;
  /** The plan's address and floor, printed on the finished plan; editable by its owner. */
  planMeta?: PlanMeta;
  onPlanMetaChange?: (meta: PlanMeta) => void;
  onPlanMetaCommit?: () => void;
  canEditPlanMeta?: boolean;
};

export function EditorToolbar({
  controller,
  isLoading = false,
  planMeta,
  onPlanMetaChange,
  onPlanMetaCommit,
  canEditPlanMeta = true,
}: EditorToolbarProps) {
  const showSymbolLibrary = controller.activeTool === "symbol";
  const showFurnitureLibrary = controller.activeTool === "furniture";
  const showDimensionMode = controller.activeTool === "dimension";
  const expandedLibraryView = showSymbolLibrary || showFurnitureLibrary;
  const selected = controller.selectedObject;
  const totalArea = controller.document ? totalRoomArea(controller.document) : null;

  const subViewTitle = showFurnitureLibrary
    ? "Möbler"
    : showSymbolLibrary
      ? "Symbolbibliotek"
      : showDimensionMode
        ? "Mått"
        : null;

  return (
    <aside
      className={`flex shrink-0 border-b border-[#e8e2d8] bg-[#f7f4ef] px-2 ${
        expandedLibraryView ? "min-h-40" : "h-28"
      } ${subViewTitle ? "flex-col py-2" : "items-center"} ${isLoading ? "pointer-events-none opacity-60" : ""}`}
      aria-busy={isLoading}
    >
      <div className={`min-h-0 w-full ${subViewTitle ? "flex flex-1 flex-col" : "flex items-center gap-2 overflow-y-auto"}`}>
        {subViewTitle ? (
          <>
            <p className="shrink-0 text-center text-xs font-semibold text-[#4d463f]">{subViewTitle}</p>
            <div className="relative flex flex-1 items-center justify-center">
              <button
                type="button"
                onClick={() => controller.setActiveTool("select")}
                className="absolute left-0 inline-flex shrink-0 flex-col items-center gap-1 rounded-none px-2 py-2 text-[10px] font-semibold text-[#4d463f] transition hover:bg-[#ece7df]"
              >
                <ArrowLeft size={18} />
                <span>Tillbaka</span>
              </button>
              {showDimensionMode ? (
                <p className="text-xs text-[#6a6258]">Klicka start och slut på planritningen</p>
              ) : null}
              {showSymbolLibrary ? (
                <LibraryPickerRow
                  items={FLOORPLAN_SYMBOLS}
                  selectedId={controller.selectedSymbolId}
                  onSelect={controller.setSelectedSymbolId}
                />
              ) : null}
              {showFurnitureLibrary ? (
                <LibraryPickerRow
                  items={FLOORPLAN_FURNITURE}
                  selectedId={controller.selectedFurnitureId}
                  onSelect={controller.setSelectedFurnitureId}
                />
              ) : null}
            </div>
          </>
        ) : (
          <div className="flex min-w-0 w-full items-center gap-2">
            <div className="grid min-w-0 flex-1 grid-cols-9 items-center justify-items-center">
              {TOOLS.map((tool) => {
                const isActive = controller.activeTool === tool.id;
                return (
                  <button
                    key={tool.id}
                    type="button"
                    title={tool.hint ? `${tool.label} — ${tool.hint}` : tool.label}
                    onClick={() => controller.setActiveTool(tool.id)}
                    className={`inline-flex flex-col items-center gap-1 rounded-none px-2 py-2 text-[10px] font-semibold transition ${
                      isActive ? "bg-[#5c544a] text-white" : "text-[#4d463f] hover:bg-[#ece7df]"
                    }`}
                  >
                    {tool.icon}
                    <span>{tool.label}</span>
                  </button>
                );
              })}
            </div>
            {selected ? (
              <div className="ml-2 flex min-w-0 flex-1 items-end gap-3 border-l border-[#e8e2d8] pl-3">
                <SelectedObjectFields selected={selected} controller={controller} />
                <button
                  type="button"
                  onClick={() => controller.deleteSelected()}
                  className="inline-flex shrink-0 flex-col items-center gap-1 rounded-none px-2 py-2 text-[10px] font-semibold text-[#4d463f] transition hover:bg-[#ece7df]"
                >
                  <Trash2 size={18} />
                  <span>Radera</span>
                </button>
              </div>
            ) : planMeta || totalArea ? (
              <div className="ml-2 flex min-w-0 flex-1 items-end gap-3 overflow-x-auto border-l border-[#e8e2d8] pl-3">
                {planMeta && onPlanMetaChange ? (
                  <>
                    <TextField
                      label="Adress"
                      value={planMeta.address}
                      disabled={!canEditPlanMeta}
                      maxLength={120}
                      onChange={(value) => onPlanMetaChange({ ...planMeta, address: value })}
                      onBlur={onPlanMetaCommit}
                      className="min-w-[160px]"
                    />
                    <TextField
                      label="Våning"
                      value={planMeta.floorLabel}
                      disabled={!canEditPlanMeta}
                      maxLength={40}
                      list="floor-labels"
                      onChange={(value) => onPlanMetaChange({ ...planMeta, floorLabel: value.toUpperCase() })}
                      onBlur={onPlanMetaCommit}
                      className="min-w-[110px]"
                    />
                    <datalist id="floor-labels">
                      {FLOOR_LABELS.map((label) => (
                        <option key={label} value={label} />
                      ))}
                    </datalist>
                  </>
                ) : null}
                {totalArea ? (
                  <ReadOnlyField
                    label={`Total yta (${totalArea.rooms} rum)`}
                    value={`ca ${formatSquareMeters(totalArea.squareMeters)}`}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </aside>
  );
}

function SelectedObjectFields({
  selected,
  controller,
}: {
  selected: NonNullable<FloorplanEditorController["selectedObject"]>;
  controller: FloorplanEditorController;
}) {
  const scale = controller.document?.scale;
  // On a plan with a scale, widths are edited in metres; without one, in pixels as before.
  const widthField = (width: number) =>
    scale ? (
      <NumberField
        label="Bredd (m)"
        value={Math.round((width / scale.pxPerMeter) * 100) / 100}
        step={0.05}
        onChange={(value) => controller.updateSelectedObject({ width: value * scale.pxPerMeter })}
      />
    ) : (
      <NumberField
        label="Bredd"
        value={width}
        onChange={(value) => controller.updateSelectedObject({ width: value })}
      />
    );

  const fields = (() => {
    switch (selected.type) {
      case "roomLabel":
        return (
          <>
            <TextField
              label="Text"
              value={selected.text}
              onChange={(value) => controller.updateSelectedObject({ text: value })}
              className="min-w-[120px]"
            />
            <NumberField
              label="Textstorlek"
              value={selected.fontSize}
              onChange={(value) => controller.updateSelectedObject({ fontSize: value })}
            />
            {selected.areaM2 !== undefined ? (
              <ReadOnlyField label="Yta" value={`ca ${formatSquareMeters(selected.areaM2)}`} />
            ) : null}
          </>
        );
      case "dimension":
        return (
          <TextField
            label="Måttext"
            value={selected.label}
            onChange={(value) => controller.updateSelectedObject({ label: value })}
            className="min-w-[100px]"
          />
        );
      case "door":
        return (
          <>
            {widthField(selected.width)}
            <SelectField
              label="Öppningsriktning"
              value={selected.swing}
              options={[
                { value: "left", label: "Vänster" },
                { value: "right", label: "Höger" },
              ]}
              onChange={(value) =>
                controller.updateSelectedObject({
                  swing: value as "left" | "right",
                })
              }
            />
            {/* A scan cannot tell which way a door opens; this flips it to the wall's other side. */}
            <button
              type="button"
              onClick={() => controller.updateSelectedObject(flipDoorSide(selected))}
              className="shrink-0 rounded-none border border-[#d8d2c8] bg-white px-3 py-1.5 text-xs font-semibold text-[#4d463f] transition hover:bg-[#f2ede5]"
            >
              Byt sida
            </button>
          </>
        );
      case "window":
        return (
          <>
            {widthField(selected.width)}
            <NumberField
              label="Höjd"
              value={selected.height}
              onChange={(value) => controller.updateSelectedObject({ height: value })}
            />
          </>
        );
      case "symbol": {
        // A counter, wardrobe or appliance at its real size: what it measures along its front and
        // how deep it is. Any earlier resize on the canvas is folded in.
        const length = selected.width * selected.scaleX;
        const depth = selected.height * selected.scaleY;
        const resize = (next: { width?: number; height?: number }) =>
          controller.updateSelectedObject({
            width: next.width ?? length,
            height: next.height ?? depth,
            scaleX: 1,
            scaleY: 1,
            textSize: abbreviationTextSize(selected),
          });
        const letters = abbreviationTextSize(selected);
        const letterField =
          letters !== undefined ? (
            <NumberField
              label="Textstorlek"
              value={Math.round(letters)}
              onChange={(value) => value > 0 && controller.updateSelectedObject({ textSize: value })}
            />
          ) : null;
        return scale ? (
          <>
            <NumberField
              label="Längd (m)"
              value={Math.round((length / scale.pxPerMeter) * 100) / 100}
              step={0.05}
              onChange={(value) => value > 0 && resize({ width: value * scale.pxPerMeter })}
            />
            <NumberField
              label="Djup (m)"
              value={Math.round((depth / scale.pxPerMeter) * 100) / 100}
              step={0.05}
              onChange={(value) => value > 0 && resize({ height: value * scale.pxPerMeter })}
            />
            {letterField}
          </>
        ) : (
          <>
            <NumberField label="Bredd" value={Math.round(length)} onChange={(value) => value > 0 && resize({ width: value })} />
            <NumberField label="Höjd" value={Math.round(depth)} onChange={(value) => value > 0 && resize({ height: value })} />
            {letterField}
          </>
        );
      }
      case "wall":
        return (
          <>
            <NumberField
              label="Linjebredd"
              value={selected.strokeWidth}
              onChange={(value) => controller.updateSelectedObject({ strokeWidth: value })}
            />
            {scale ? (
              <ReadOnlyField label="Längd" value={formatMeters(lineLengthInMeters(scale, selected))} />
            ) : null}
          </>
        );
      default:
        return null;
    }
  })();

  if (!fields) {
    return null;
  }

  return <div className="flex min-w-0 flex-1 items-end gap-3 overflow-x-auto">{fields}</div>;
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="block shrink-0 text-xs font-semibold text-[#4d463f]">
      {label}
      <p className="mt-1 py-1.5 text-sm font-normal text-[#4d463f]">{value}</p>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
}) {
  return (
    <label className="block shrink-0 text-xs font-semibold text-[#4d463f]">
      {label}
      <input
        type="number"
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 block w-20 rounded-none border border-[#d8d2c8] bg-white px-2 py-1.5 text-sm text-[#4d463f]"
      />
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  onBlur,
  disabled = false,
  maxLength,
  list,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  maxLength?: number;
  list?: string;
  className?: string;
}) {
  return (
    <label className={`block shrink-0 text-xs font-semibold text-[#4d463f] ${className}`}>
      {label}
      <input
        type="text"
        value={value}
        disabled={disabled}
        maxLength={maxLength}
        list={list}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        className="mt-1 w-full min-w-20 rounded-none border border-[#d8d2c8] bg-white px-2 py-1.5 text-sm text-[#4d463f] disabled:opacity-60"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block shrink-0 text-xs font-semibold text-[#4d463f]">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 rounded-none border border-[#d8d2c8] bg-white px-2 py-1.5 text-sm text-[#4d463f]"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

type LibraryIcon = {
  id: string;
  label: string;
  paths: string[];
  size: readonly [number, number];
  text?: string;
};

/** The icon as it is drawn on the plan, fitted into the button. */
function FloorplanPathIcon({ icon, className }: { icon: LibraryIcon; className?: string }) {
  const [width, height] = icon.size;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden="true">
      {icon.paths.map((path, index) => (
        <path
          key={index}
          d={path}
          fill="none"
          stroke="currentColor"
          // Same visual weight for every icon, however large its real-size box.
          strokeWidth={1.25}
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {icon.text ? (
        <text
          x={width / 2}
          y={height / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily={SM_ROOM_LABEL_FONT}
          fontWeight={SM_ROOM_LABEL_WEIGHT}
          fontSize={abbreviationFontSize(width, height, icon.text)}
          fill="currentColor"
        >
          {icon.text}
        </text>
      ) : null}
    </svg>
  );
}

function LibraryPickerButton({
  icon,
  selected,
  onSelect,
}: {
  icon: LibraryIcon;
  selected: boolean;
  onSelect: () => void;
}) {
  const label = icon.label;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-none border px-2 py-1.5 text-xs transition ${
        selected
          ? "border-[#5c544a] bg-[#5c544a] text-white"
          : "border-[#d8d2c8] bg-white text-[#4d463f] hover:bg-[#f2ede5]"
      }`}
    >
      <FloorplanPathIcon icon={icon} className="h-6 w-6 shrink-0" />
      <span>{label}</span>
    </button>
  );
}

function LibraryPickerRow({
  items,
  selectedId,
  onSelect,
}: {
  items: readonly LibraryIcon[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 px-16">
      {items.map((item) => (
        <LibraryPickerButton
          key={item.id}
          icon={item}
          selected={selectedId === item.id}
          onSelect={() => onSelect(item.id)}
        />
      ))}
    </div>
  );
}
