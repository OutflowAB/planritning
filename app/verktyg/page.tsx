"use client";

import { Loader2 } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { FloorplanEditor } from "@/components/floorplan-editor/floorplan-editor";
import {
  buildPlanritningarHref,
  buildVerktygHref,
  buildPlanritningarListHref,
  clearPendingVerktygSave,
  getPendingVerktygSave,
  setPendingVerktygSave,
} from "@/lib/verktyg-save-session";
import { apiFetch, apiJson, describeError } from "@/lib/api-client";
import { dispatchLibraryUpdated } from "@/lib/app-events";
import { buildFloorplanImageUrl } from "@/lib/floorplan/image-url";
import { imageDownloadBaseName } from "@/lib/image-naming";

type ApprovedImageRow = {
  id: number;
  file_name: string;
  file_path: string;
  created_at: string;
  preview_url: string;
  is_saved: boolean;
};

/**
 * The editor is only ever reached from a specific floor plan, so there is nothing to show
 * without one. Anyone landing here directly belongs in the list they came from.
 */
function RedirectToPlanritningar() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    router.replace(buildPlanritningarListHref(pathname));
  }, [pathname, router]);

  return (
    <section className="flex min-h-[calc(100vh-4rem)] w-full items-center justify-center bg-[#f5f3f0] px-4 py-6 sm:px-6 sm:py-10">
      <div className="flex items-center gap-2 text-sm text-[#6a6258]" role="status">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        Öppnar planritningar...
      </div>
    </section>
  );
}

function buildStubApprovedImage(imageId: string, imagePath: string): ApprovedImageRow {
  const id = Number(imageId);
  return {
    id,
    file_name: imageDownloadBaseName(id),
    file_path: imagePath,
    created_at: new Date().toISOString(),
    preview_url: buildFloorplanImageUrl(id, imagePath),
    is_saved: false,
  };
}

function VerktygEditor() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const imageIdParam = searchParams.get("imageId") ?? searchParams.get("previewImageId");
  const imagePathParam = searchParams.get("imagePath") ?? searchParams.get("previewImagePath");
  const [approvedImage, setApprovedImage] = useState<ApprovedImageRow | null>(null);
  const [loadError, setLoadError] = useState("");
  const [isPublishing, setIsPublishing] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadApprovedImage() {
      setLoadError("");
      setApprovedImage(null);

      const params = new URLSearchParams();
      if (imageIdParam) {
        params.set("imageId", imageIdParam);
      }
      if (imagePathParam) {
        params.set("imagePath", imagePathParam);
      }

      try {
        const data = await apiJson<{ message?: string; image?: ApprovedImageRow }>(
          `/api/approved-generation?${params.toString()}`,
          { cache: "no-store" },
        );

        if (!active) {
          return;
        }

        if (!data.image?.preview_url) {
          clearPendingVerktygSave();
          setLoadError(data.message ?? "Kunde inte hämta den godkända bilden.");
          return;
        }

        if (data.image.is_saved) {
          clearPendingVerktygSave();
          router.replace(
            buildPlanritningarHref(pathname, {
              imageId: data.image.id,
              imagePath: data.image.file_path,
            }),
          );
          return;
        }

        setPendingVerktygSave({
          imageId: data.image.id,
          imagePath: data.image.file_path,
        });

        setApprovedImage(data.image);
      } catch (error) {
        if (!active) {
          return;
        }
        clearPendingVerktygSave();
        setLoadError(describeError(error, "Kunde inte hämta den godkända bilden just nu.") ?? "Kunde inte hämta den godkända bilden just nu.");
      }
    }

    void loadApprovedImage();

    return () => {
      active = false;
    };
  }, [imageIdParam, imagePathParam, pathname, router]);

  async function saveImageToLibrary() {
    if (!approvedImage) {
      return;
    }

    await apiFetch("/api/save-generation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageId: approvedImage.id, filePath: approvedImage.file_path }),
    });
  }

  async function saveToLibrary() {
    if (!approvedImage || isPublishing) {
      return;
    }

    setIsPublishing(true);
    setLoadError("");

    try {
      await saveImageToLibrary();
      clearPendingVerktygSave();
      dispatchLibraryUpdated();
      router.push(
        buildPlanritningarHref(pathname, {
          imageId: approvedImage.id,
          imagePath: approvedImage.file_path,
        }),
      );
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Kunde inte spara bilden just nu.");
      setIsPublishing(false);
    }
  }

  async function leaveToPlanritningar() {
    if (!approvedImage || isLeaving) {
      return;
    }

    setIsLeaving(true);
    setLoadError("");

    try {
      clearPendingVerktygSave();
      router.push(buildPlanritningarListHref(pathname));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Kunde inte lämna redigeraren.");
      setIsLeaving(false);
    }
  }

  if (loadError) {
    const fallbackImage =
      imageIdParam && imagePathParam
        ? buildStubApprovedImage(imageIdParam, imagePathParam)
        : null;

    if (fallbackImage) {
      return (
        <FloorplanEditor
          approvedImage={fallbackImage}
          imageLoadError={loadError}
          onSaveToLibrary={saveToLibrary}
          onLeaveWithoutSaving={leaveToPlanritningar}
          isPublishing={isPublishing}
          isLeaving={isLeaving}
        />
      );
    }

    return (
      <section className="flex min-h-[calc(100vh-4rem)] w-full items-center justify-center bg-[#f5f3f0] px-4 py-6 sm:px-6 sm:py-10">
        <p className="max-w-lg rounded-none border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {loadError}
        </p>
      </section>
    );
  }

  const editorImage =
    approvedImage ??
    (imageIdParam && imagePathParam
      ? buildStubApprovedImage(imageIdParam, imagePathParam)
      : null);

  if (!editorImage) {
    return <RedirectToPlanritningar />;
  }

  return (
    <FloorplanEditor
      approvedImage={editorImage}
      onSaveToLibrary={saveToLibrary}
      onLeaveWithoutSaving={leaveToPlanritningar}
      isPublishing={isPublishing}
      isLeaving={isLeaving}
    />
  );
}

function VerktygContent() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const imageIdParam = searchParams.get("imageId") ?? searchParams.get("previewImageId");
  const imagePathParam = searchParams.get("imagePath") ?? searchParams.get("previewImagePath");
  const [isRestoringSession, setIsRestoringSession] = useState(() => !imageIdParam && !imagePathParam);

  useEffect(() => {
    // Deferred past the effect body: the decision reads sessionStorage, which the server
    // render could not see, so it must not feed back into state during hydration.
    const timer = window.setTimeout(() => {
      if (imageIdParam || imagePathParam) {
        setIsRestoringSession(false);
        return;
      }

      const pendingSave = getPendingVerktygSave();
      if (pendingSave) {
        router.replace(buildVerktygHref(pathname, pendingSave));
        return;
      }

      setIsRestoringSession(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [imageIdParam, imagePathParam, pathname, router]);

  if (isRestoringSession) {
    return (
      <section className="flex min-h-[calc(100vh-4rem)] w-full items-center justify-center bg-[#f5f3f0] px-4 py-6 sm:px-6 sm:py-10">
        <div className="flex items-center gap-2 text-sm text-[#6a6258]">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          Hämtar pågående redigering...
        </div>
      </section>
    );
  }

  if (!imageIdParam && !imagePathParam) {
    return <RedirectToPlanritningar />;
  }

  return <VerktygEditor />;
}

export default function VerktygPage() {
  return (
    <Suspense
      fallback={
        <section className="flex min-h-[calc(100vh-4rem)] w-full items-center justify-center bg-[#f5f3f0] px-4 py-6 sm:px-6 sm:py-10">
          <div className="flex items-center gap-2 text-sm text-[#6a6258]">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            Laddar verktyg...
          </div>
        </section>
      }
    >
      <VerktygContent />
    </Suspense>
  );
}
