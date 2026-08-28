import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
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
  onUploadComplete,
  label = "Offer image",
  removeHelpText = "Removing the override uses the purchased product image.",
}: {
  imageOptions: OfferImageOption[];
  imageUrl: string;
  productTitle: string;
  canUpload: boolean;
  onChange: (imageUrl: string) => void;
  onUploadComplete?: (imageUrl: string) => void;
  label?: string;
  removeHelpText?: string;
}) {
  const uploadFetcher = useFetcher<ImageUploadResponse>();
  const shopify = useAppBridge();
  const onChangeRef = useRef(onChange);
  const onUploadCompleteRef = useRef(onUploadComplete);
  const replacementInputRef = useRef<HTMLInputElement>(null);
  const { data: uploadData, load, submit } = uploadFetcher;
  const [isUploading, setIsUploading] = useState(false);
  const options = useMemo(() => {
    if (!imageUrl || imageOptions.some((option) => option.url === imageUrl)) {
      return imageOptions;
    }
    return [
      { url: imageUrl, label: "Uploaded Shopify image" },
      ...imageOptions,
    ];
  }, [imageOptions, imageUrl]);

  useEffect(() => {
    onChangeRef.current = onChange;
    onUploadCompleteRef.current = onUploadComplete;
  }, [onChange, onUploadComplete]);

  useEffect(() => {
    const data = uploadData;
    if (!data) return;
    if (data.ok && data.imageUrl) {
      const timer = window.setTimeout(() => {
        setIsUploading(false);
        onChangeRef.current(data.imageUrl!);
        onUploadCompleteRef.current?.(data.imageUrl!);
        shopify.toast.show(
          onUploadCompleteRef.current
            ? "Image uploaded. Saving offer…"
            : "Image uploaded. Save the offer to apply it.",
        );
      }, 0);
      return () => window.clearTimeout(timer);
    }
    if (data.ok && data.processing && data.fileId) {
      const timer = window.setTimeout(() => {
        load(
          `/app/upload-image?id=${encodeURIComponent(data.fileId!)}&attempt=${data.attempt ?? 0}`,
        );
      }, 500);
      return () => window.clearTimeout(timer);
    }
    if (!data.ok) {
      const timer = window.setTimeout(() => {
        setIsUploading(false);
        shopify.toast.show(data.message, { isError: true });
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [load, shopify, uploadData]);

  const uploadImage = (file: File | undefined) => {
    if (!file) return;
    setIsUploading(true);
    const formData = new FormData();
    formData.set("image", file);
    formData.set("alt", `${productTitle} upsell offer`);
    submit(formData, {
      method: "post",
      action: "/app/upload-image",
      encType: "multipart/form-data",
    });
  };

  const uploadReplacementImage = (event: ChangeEvent<HTMLInputElement>) => {
    uploadImage(event.currentTarget.files?.[0]);
    event.currentTarget.value = "";
  };

  return (
    <s-stack direction="block" gap="base">
      {options.length > 0 && (
        <s-select
          label={label}
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

      {imageUrl ? (
        <s-box padding="base" border="base" borderRadius="base">
          <s-grid gridTemplateColumns="96px 1fr" gap="base" alignItems="center">
            <s-image
              src={imageUrl}
              alt={`${productTitle} offer image`}
              aspectRatio="1/1"
              objectFit="contain"
            />
            <s-stack direction="block" gap="small">
              <s-text type="strong">{label}</s-text>
              <s-button
                type="button"
                disabled={!canUpload || isUploading}
                onClick={() => replacementInputRef.current?.click()}
              >
                Change image
              </s-button>
              <s-button
                type="button"
                variant="tertiary"
                onClick={() => onChange("")}
              >
                Remove image
              </s-button>
              <s-text color="subdued">{removeHelpText}</s-text>
            </s-stack>
          </s-grid>
          <input
            ref={replacementInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            disabled={!canUpload || isUploading}
            onChange={uploadReplacementImage}
            hidden
          />
        </s-box>
      ) : (
        <s-drop-zone
          label={`Upload ${label.toLowerCase()}`}
          accessibilityLabel={`Upload ${label.toLowerCase()} to Shopify Files`}
          accept="image/jpeg,image/png,image/webp,image/gif"
          disabled={!canUpload || isUploading}
          error={
            canUpload
              ? ""
              : "Reopen or reinstall the app and approve Shopify Files access first."
          }
          onChange={(event) => uploadImage(event.currentTarget.files[0])}
        />
      )}
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
