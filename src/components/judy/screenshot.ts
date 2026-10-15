import type { ImageInput } from "@/lib/pipeline/judy";

// Shrinks a screenshot in the browser to at most 1600px (JPEG) before it is sent.
// The image is only ever held in memory; it is never stored.
export async function shrinkScreenshot(file: File): Promise<ImageInput> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("That file is not a picture."));
      el.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser cannot read pictures.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    return { media_type: "image/jpeg", data: dataUrl.slice(dataUrl.indexOf(",") + 1) };
  } finally {
    URL.revokeObjectURL(url);
  }
}
