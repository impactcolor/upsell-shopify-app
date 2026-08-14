import { useEffect, useMemo, useRef } from "react";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";

import type { ImageUploadResponse } from "../routes/app.upload-image";

export type OfferImageOption = { url: string; label: string };

export function OfferImagePicker({
  imageOptions,
  imageUrl,
  productTitle,
  canUpload,
  onChange,
}: {
  imageOptions: OfferImageOption[];
  imageUrl: string;
  productTitle: string;
  canUpload: boolean;
  onChange: (imageUrl: string) => void;
}) {
  const uploadFetcher = useFetcher<ImageUploadResponse>();
  const shopify = useAppBridge();
  const onChangeRef = useRef(onChange);
  const { data: uploadData, load, state, submit } = uploadFetcher;
  const isUploading = state !== "idle";
  const options = useMemo(() => {
    if (!imageUrl || imageOptions.some((option) => option.url === imageUrl)) {
      return imageOptions;
    }
    return [{ url: imageUrl, label: "Uploaded Shopify image" }, ...imageOptions];
  }, [imageOptions, imageUrl]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const data = uploadData;
    if (!data) return;
    if (data.ok && data.imageUrl) {
      onChangeRef.current(data.imageUrl);
      shopify.toast.show("Image uploaded to Shopify");
      return;
    }
    if (data.ok && data.processing && data.fileId) {
      const timer = window.setTimeout(() => {
        load(
          `/app/upload-image?id=${encodeURIComponent(data.fileId!)}&attempt=${data.attempt ?? 0}`,
        );
      }, 500);
      return () => window.clearTimeout(timer);
    }
    if (!data.ok) shopify.toast.show(data.message, { isError: true });
  }, [load, shopify, uploadData]);

  const uploadImage = (file: File | undefined) => {
    if (!file) return;
    const formData = new FormData();
    formData.set("image", file);
    formData.set("alt", `${productTitle} upsell offer`);
    submit(formData, {
      method: "post",
      action: "/app/upload-image",
      encType: "multipart/form-data",
    });
  };

  return (
    <s-stack direction="block" gap="base">
      {options.length > 0 && (
        <s-select
          label="Offer image"
          value={imageUrl}
          onChange={(event) => onChange(event.currentTarget.value)}
        >
          {options.map((image) => (
            <s-option key={image.url} value={image.url}>
              {image.label}
            </s-option>
          ))}
        </s-select>
      )}

      <s-drop-zone
        label="Upload a custom offer image"
        accessibilityLabel="Upload a custom offer image to Shopify Files"
        accept="image/jpeg,image/png,image/webp,image/gif"
        disabled={!canUpload || isUploading}
        error={
          canUpload
            ? ""
            : "Reopen or reinstall the app and approve Shopify Files access first."
        }
        onChange={(event) => uploadImage(event.currentTarget.files[0])}
      />
      <s-text color="subdued">
        JPG, PNG, WEBP, or GIF up to 10 MB. Uploads are stored in Shopify Files
        and served from Shopify&apos;s CDN.
      </s-text>
      {isUploading && (
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-spinner size="base" accessibilityLabel="Uploading image" />
          <s-text>Uploading and processing image…</s-text>
        </s-stack>
      )}
    </s-stack>
  );
}
