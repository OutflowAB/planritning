"use client";

import Image from "next/image";
import { Loader2 } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { FloorplanEditor } from "@/components/floorplan-editor/floorplan-editor";
import {
  buildPlanritningarHref,
  buildVerktygHref,
  buildVerktygListHref,
  clearPendingVerktygSave,
  getPendingVerktygSave,
  setPendingVerktygSave,
} from "@/lib/verktyg-save-session";
import { buildFloorplanImageUrl } from "@/lib/floorplan/image-url";
import { imageDisplayName, imageDownloadBaseName } from "@/lib/image-naming";

type ApprovedImageRow = {
  id: number;
  file_name: string;
  file_path: string;
  created_at: string;
  preview_url: string;
  is_saved: boolean;
};

type PendingVerktygImageRow = {
  id: number;
  file_name: string;
  file_path: string;
  created_at: string;
  preview_url: string | null;
};

function VerktygList() {
  const pathname = usePathname();
  const router = useRouter();
  const [images, setImages] = useState<PendingVerktygImageRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadPendingImages() {
      setIsLoading(true);
      setLoadError("");

      try {
        const response = await fetch("/api/pending-verktyg", { cache: "no-store" });
        const data = (await response.json()) as {
          message?: string;
          images?: PendingVerktygImageRow[];
        };

        if (!active) {
          return;
        }

        if (!response.ok) {
          setLoadError(data.message ?? "Kunde inte hämta planritningar i verktyg.");
          setImages([]);
          setIsLoading(false);
          return;
        }

        setImages(data.images ?? []);
        setIsLoading(false);
      } catch {
        if (!active) {
          return;
        }
        setLoadError("Kunde inte hämta planritningar i verktyg just nu.");
        setImages([]);
        setIsLoading(false);
      }
    }

    void loadPendingImages();

    function handleLibraryUpdated() {
      void loadPendingImages();
    }

    window.addEventListener("library-updated", handleLibraryUpdated);

    return () => {
      active = false;
      window.removeEventListener("library-updated", handleLibraryUpdated);
    };
  }, []);

  function openImage(image: PendingVerktygImageRow) {
    router.push(
      buildVerktygHref(pathname, {
        imageId: image.id,
        imagePath: image.file_path,
      }),
    );
  }

  return (
    <section className="flex min-h-[calc(100vh-4rem)] w-full items-center justify-center bg-[#f5f3f0] px-6 py-10">
      <div className="w-full rounded-none border border-[#d8d2c8] bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-semibold text-[#3d3a36]">Verktyg</h1>
        </div>

        {isLoading ? (
          <div className="mt-6 flex items-center justify-center gap-2 rounded-none border border-[#d8d2c8] bg-[#f7f4ef] px-4 py-6 text-[#6a6258]">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            <p className="text-sm font-medium">Hämtar planritningar...</p>
          </div>
        ) : null}

        {loadError ? (
          <p className="mt-6 rounded-none border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {loadError}
          </p>
        ) : null}

        {!isLoading && !loadError && images.length === 0 ? (
          <p className="mt-6 text-sm text-[#6a6258]">
            Inga osparade planritningar finns i verktyg. Godkänn en genererad bild på startsidan
            för att börja redigera här.
          </p>
        ) : null}

        {!isLoading && !loadError && images.length > 0 ? (
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            {images.map((image) => (
              <article
                key={image.id}
                className="overflow-hidden rounded-none border border-[#d8d2c8] bg-white"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e8e2d8] bg-[#f7f4ef] px-4 py-3">
                  <p className="text-xs font-medium text-[#7b746a]">
                    {new Date(image.created_at).toLocaleString("sv-SE")}
                  </p>
                  <p className="text-xs font-semibold text-[#6a6258]">Bild {image.id}</p>
                </div>

                <div className="flex items-center justify-center bg-[#f0ece6] p-4">
                  {image.preview_url ? (
                    <button
                      type="button"
                      onClick={() => openImage(image)}
                      className="cursor-pointer"
                    >
                      <Image
                        src={image.preview_url}
                        alt={imageDisplayName(image.id)}
                        width={1200}
                        height={900}
                        className="max-h-[220px] w-auto max-w-full rounded-none border border-[#d8d2c8] bg-white object-contain"
                      />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openImage(image)}
                      className="flex h-52 w-full items-center justify-center rounded-none border border-[#d8d2c8] bg-[#f7f4ef] text-sm text-[#7b746a]"
                    >
                      Öppna planritning
                    </button>
                  )}
                </div>

                <div className="border-t border-[#e8e2d8] bg-white px-4 py-3">
                  <button
                    type="button"
                    onClick={() => openImage(image)}
                    className="w-full rounded-none border border-[#d8d2c8] bg-white px-3 py-1.5 text-xs font-semibold text-[#4d463f] transition hover:bg-[#f2ede5]"
                  >
                    Fortsätt redigera
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : null}
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
        const response = await fetch(`/api/approved-generation?${params.toString()}`, {
          cache: "no-store",
        });
        const data = (await response.json()) as {
          message?: string;
          image?: ApprovedImageRow;
        };

        if (!active) {
          return;
        }

        if (!response.ok || !data.image?.preview_url) {
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
      } catch {
        if (!active) {
          return;
        }
        clearPendingVerktygSave();
        setLoadError("Kunde inte hämta den godkända bilden just nu.");
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

    const response = await fetch("/api/save-generation", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        imageId: approvedImage.id,
        filePath: approvedImage.file_path,
      }),
    });
    const data = (await response.json()) as { message?: string };

    if (!response.ok) {
      throw new Error(data.message ?? "Kunde inte spara bilden just nu.");
    }
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
      window.dispatchEvent(new Event("library-updated"));
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

  async function leaveToVerktygList() {
    if (!approvedImage || isLeaving) {
      return;
    }

    setIsLeaving(true);
    setLoadError("");

    try {
      clearPendingVerktygSave();
      router.push(buildVerktygListHref(pathname));
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
          onLeaveWithoutSaving={leaveToVerktygList}
          isPublishing={isPublishing}
          isLeaving={isLeaving}
        />
      );
    }

    return (
      <section className="flex min-h-[calc(100vh-4rem)] w-full items-center justify-center bg-[#f5f3f0] px-6 py-10">
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
    return <VerktygList />;
  }

  return (
    <FloorplanEditor
      approvedImage={editorImage}
      onSaveToLibrary={saveToLibrary}
      onLeaveWithoutSaving={leaveToVerktygList}
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
  }, [imageIdParam, imagePathParam, pathname, router]);

  if (isRestoringSession) {
    return (
      <section className="flex min-h-[calc(100vh-4rem)] w-full items-center justify-center bg-[#f5f3f0] px-6 py-10">
        <div className="flex items-center gap-2 text-sm text-[#6a6258]">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          Hämtar pågående redigering...
        </div>
      </section>
    );
  }

  if (!imageIdParam && !imagePathParam) {
    return <VerktygList />;
  }

  return <VerktygEditor />;
}

export default function VerktygPage() {
  return (
    <Suspense
      fallback={
        <section className="flex min-h-[calc(100vh-4rem)] w-full items-center justify-center bg-[#f5f3f0] px-6 py-10">
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
