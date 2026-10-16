"use client";

import {
  AppWindow,
  ArrowLeft,
  DoorOpen,
  Eraser,
  LayoutGrid,
  MousePointer2,
  MoveHorizontal,
  Ruler,
  Sofa,
  Trash2,
  Type,
} from "lucide-react";

import type { FloorplanEditorController } from "@/components/floorplan-editor/hooks/use-floorplan-editor";
import { flipDoorSide } from "@/lib/floorplan/door";
import { formatMeters, formatSquareMeters, lineLengthInMeters, totalRoomArea } from "@/lib/floorplan/measure";
import { FLOORPLAN_FURNITURE, FLOORPLAN_SYMBOLS } from "@/lib/floorplan/symbol-library";
import type { EditorTool } from "@/lib/floorplan/types";

type ToolDefinition = {
  id: EditorTool;
  label: string;
  icon: React.ReactNode;
  hint?: string;
};

const DISABLED_TOOLS: ReadonlySet<EditorTool> = new Set(["furniture"]);

const TOOLS: ToolDefinition[] = [
  { id: "select", label: "Markera", icon: <MousePointer2 size={18} /> },
  { id: "eraser", label: "Sudda", icon: <Eraser size={18} /> },
  { id: "roomLabel", label: "Rum", icon: <Type size={18} /> },
  { id: "dimension", label: "Mått", icon: <Ruler size={18} />, hint: "Klicka start och slut" },
  { id: "door", label: "Dörr", icon: <DoorOpen size={18} /> },
  { id: "window", label: "Fönster", icon: <AppWindow size={18} /> },
  { id: "stair", label: "Trappa", icon: <MoveHorizontal size={18} /> },
  { id: "symbol", label: "Symbol", icon: <LayoutGrid size={18} /> },
  { id: "furniture", label: "Möbler", icon: <Sofa size={18} /> },
];

type EditorToolbarProps = {
  controller: FloorplanEditorController;
  isLoading?: boolean;
};

export function EditorToolbar({ controller, isLoading = false }: EditorToolbarProps) {
  const showSymbolLibrary = controller.activeTool === "symbol";
  const showFurnitureLibrary = controller.activeTool === "furniture";
  const showDimensionMode = controller.activeTool === "dimension";
  const expandedLibraryView = showSymbolLibrary || showFurnitureLibrary;
  const selected = controller.selectedObject;
  // Only scanned plans know their rooms' areas.
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
      className={`flex shrink-0 border-b border-stone-100 bg-stone-50 px-2 ${
        expandedLibraryView ? "min-h-40" : "h-28"
      } ${subViewTitle ? "flex-col py-2" : "items-center"} ${isLoading ? "pointer-events-none opacity-60" : ""}`}
      aria-busy={isLoading}
    >
      <div className={`min-h-0 w-full ${subViewTitle ? "flex flex-1 flex-col" : "flex items-center gap-2 overflow-y-auto"}`}>
        {subViewTitle ? (
          <>
            <p className="shrink-0 text-center text-xs font-semibold text-stone-800">{subViewTitle}</p>
            <div className="relative flex flex-1 items-center justify-center">
              <button
                type="button"
                onClick={() => controller.setActiveTool("select")}
                className="absolute left-0 inline-flex shrink-0 flex-col items-center gap-1 rounded-lg px-2 py-2 text-[10px] font-semibold text-stone-800 transition hover:bg-stone-100"
              >
                <ArrowLeft size={18} />
                <span>Tillbaka</span>
              </button>
              {showDimensionMode ? (
                <p className="text-xs text-stone-600">Klicka start och slut på planritningen</p>
              ) : null}
              {showSymbolLibrary ? (
                <LibraryPickerRow
                  items={FLOORPLAN_SYMBOLS.map((symbol) => ({
                    id: symbol.id,
                    label: symbol.label,
                    paths: symbol.paths,
                  }))}
                  selectedId={controller.selectedSymbolId}
                  onSelect={controller.setSelectedSymbolId}
                />
              ) : null}
              {showFurnitureLibrary ? (
                <LibraryPickerRow
                  items={FLOORPLAN_FURNITURE.map((item) => ({
                    id: item.id,
                    label: item.label,
                    paths: item.paths,
                  }))}
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
                const isDisabled = DISABLED_TOOLS.has(tool.id);
                return (
                  <button
                    key={tool.id}
                    type="button"
                    disabled={isDisabled}
                    title={
                      isDisabled
                        ? `${tool.label} — kommer snart`
                        : tool.hint
                          ? `${tool.label} — ${tool.hint}`
                          : tool.label
                    }
                    onClick={() => controller.setActiveTool(tool.id)}
                    className={`inline-flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-[10px] font-semibold transition ${
                      isDisabled
                        ? "cursor-not-allowed opacity-40"
                        : isActive
                          ? "bg-primary text-white"
                          : "text-stone-800 hover:bg-stone-100"
                    }`}
                  >
                    {tool.icon}
                    <span>{tool.label}</span>
                  </button>
                );
              })}
            </div>
            {selected ? (
              <div className="ml-2 flex min-w-0 flex-1 items-end gap-3 border-l border-stone-100 pl-3">
                <SelectedObjectFields selected={selected} controller={controller} />
                <button
                  type="button"
                  onClick={() => controller.deleteSelected()}
                  className="inline-flex shrink-0 flex-col items-center gap-1 rounded-lg px-2 py-2 text-[10px] font-semibold text-stone-800 transition hover:bg-stone-100"
                >
                  <Trash2 size={18} />
                  <span>Radera</span>
                </button>
              </div>
            ) : totalArea ? (
              <div className="ml-2 flex min-w-0 flex-1 items-end gap-3 border-l border-stone-100 pl-3">
                <ReadOnlyField
                  label={`Total yta (${totalArea.rooms} rum)`}
                  value={`ca ${formatSquareMeters(totalArea.squareMeters)}`}
                />
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
  // On a scanned plan widths are edited in metres; without a scale, in pixels as before.
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
          });
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
          </>
        ) : (
          <>
            <NumberField label="Bredd" value={Math.round(length)} onChange={(value) => value > 0 && resize({ width: value })} />
            <NumberField label="Höjd" value={Math.round(depth)} onChange={(value) => value > 0 && resize({ height: value })} />
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

  return <div className="flex min-w-0 flex-1 flex-wrap items-end gap-3">{fields}</div>;
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="block shrink-0 text-xs font-semibold text-stone-800">
      {label}
      <p className="mt-1 py-1.5 text-sm font-normal text-stone-600">{value}</p>
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
    <label className="block shrink-0 text-xs font-semibold text-stone-800">
      {label}
      <input
        type="number"
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 w-20 rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-sm text-stone-800"
      />
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <label className={`block shrink-0 text-xs font-semibold text-stone-800 ${className}`}>
      {label}
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full min-w-20 rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-sm text-stone-800"
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
    <label className="block shrink-0 text-xs font-semibold text-stone-800">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-sm text-stone-800"
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

function FloorplanPathIcon({ paths, className }: { paths: string[]; className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      {paths.map((path, index) => (
        <path
          key={index}
          d={path}
          fill="transparent"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

function LibraryPickerButton({
  label,
  paths,
  selected,
  onSelect,
}: {
  label: string;
  paths: string[];
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs transition ${
        selected
          ? "border-primary bg-primary text-white"
          : "border-stone-200 bg-white text-stone-800 hover:bg-stone-100"
      }`}
    >
      <FloorplanPathIcon paths={paths} className="h-5 w-5 shrink-0" />
      <span>{label}</span>
    </button>
  );
}

function LibraryPickerRow({
  items,
  selectedId,
  onSelect,
}: {
  items: Array<{ id: string; label: string; paths: string[] }>;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 px-16">
      {items.map((item) => (
        <LibraryPickerButton
          key={item.id}
          label={item.label}
          paths={item.paths}
          selected={selectedId === item.id}
          onSelect={() => onSelect(item.id)}
        />
      ))}
    </div>
  );
}
