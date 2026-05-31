"use client";

import { Minus, Plus, Redo2, RotateCcw, Undo2 } from "lucide-react";

import {
  FLOORPLAN_MAX_ZOOM,
  FLOORPLAN_MIN_ZOOM,
} from "@/components/floorplan-editor/hooks/use-floorplan-editor";

import type { FloorplanEditorController } from "@/components/floorplan-editor/hooks/use-floorplan-editor";

type EditorTopBarProps = {
  controller: FloorplanEditorController;
  onSaveAndPublish?: () => Promise<void>;
  onLeave?: () => void;
  onResetToOriginal?: () => void;
  isPublishing?: boolean;
  isLeaving?: boolean;
  isLoading?: boolean;
  showPublish?: boolean;
};

export function EditorTopBar({
  controller,
  onSaveAndPublish,
  onLeave,
  onResetToOriginal,
  isPublishing = false,
  isLeaving = false,
  isLoading = false,
  showPublish = false,
}: EditorTopBarProps) {
  return (
    <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-[#e8e2d8] bg-[#f7f4ef] px-3 py-2">
      <div className="flex items-center gap-2">
        {onLeave ? (
          <button
            type="button"
            onClick={onLeave}
            disabled={isLeaving || isPublishing || controller.isSaving || isLoading}
            className="rounded-none border border-[#d8d2c8] bg-white px-3 py-1.5 text-xs font-semibold text-[#4d463f] transition hover:bg-[#f2ede5] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLeaving ? "Lämnar..." : "Lämna"}
          </button>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={controller.undo}
            disabled={!controller.canUndo || isLoading}
            aria-label="Ångra"
            className="inline-flex h-8 w-8 items-center justify-center rounded-none border border-[#d8d2c8] bg-white text-[#4d463f] transition hover:bg-[#f2ede5] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Undo2 size={15} />
          </button>
          <button
            type="button"
            onClick={controller.redo}
            disabled={!controller.canRedo || isLoading}
            aria-label="Gör om"
            className="inline-flex h-8 w-8 items-center justify-center rounded-none border border-[#d8d2c8] bg-white text-[#4d463f] transition hover:bg-[#f2ede5] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Redo2 size={15} />
          </button>
          {onResetToOriginal ? (
            <button
              type="button"
              onClick={onResetToOriginal}
              disabled={!controller.canResetToOriginal || controller.isSaving || isLoading}
              className="inline-flex h-8 items-center gap-1 rounded-none border border-[#d8d2c8] bg-white px-2 text-xs font-semibold text-[#4d463f] transition hover:bg-[#f2ede5] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RotateCcw size={14} aria-hidden="true" />
              Original
            </button>
          ) : null}
        </div>

        <div aria-hidden="true" className="h-6 w-px shrink-0 bg-[#d8d2c8]" />

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={controller.zoomOut}
            disabled={controller.zoomLevel <= FLOORPLAN_MIN_ZOOM || isLoading}
            aria-label="Zooma ut"
            className="inline-flex h-8 w-8 items-center justify-center rounded-none border border-[#d8d2c8] bg-white text-[#4d463f] transition hover:bg-[#f2ede5] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Minus size={15} />
          </button>
          <span className="min-w-[3rem] text-center text-xs font-semibold tabular-nums text-[#6a6258]">
            {Math.round(controller.zoomLevel * 100)}%
          </span>
          <button
            type="button"
            onClick={controller.zoomIn}
            disabled={controller.zoomLevel >= FLOORPLAN_MAX_ZOOM || isLoading}
            aria-label="Zooma in"
            className="inline-flex h-8 w-8 items-center justify-center rounded-none border border-[#d8d2c8] bg-white text-[#4d463f] transition hover:bg-[#f2ede5] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={15} />
          </button>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        {showPublish && onSaveAndPublish ? (
          <button
            type="button"
            onClick={() => void onSaveAndPublish()}
            disabled={isPublishing || controller.isSaving || isLoading}
            className="rounded-none bg-[#5c544a] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#4f483f] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPublishing ? "Skickar..." : "Skicka till Planritningar"}
          </button>
        ) : null}
      </div>
    </header>
  );
}
