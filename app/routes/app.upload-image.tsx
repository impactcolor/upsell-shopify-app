import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import {
  getShopifyImageStatus,
  uploadOfferImageToShopify,
} from "../models/shopify-image-upload.server";
import { authenticate } from "../shopify.server";

export type ImageUploadResponse = {
  ok: boolean;
  message: string;
  fileId?: string;
  imageUrl?: string;
  processing?: boolean;
  attempt?: number;
};

const hasFileWriteAccess = (scope: string | undefined) =>
  new Set((scope ?? "").split(",").map((item) => item.trim())).has(
    "write_files",
  );

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  if (!hasFileWriteAccess(session.scope)) {
    return Response.json(
      {
        ok: false,
        message:
          "Approve the app's Shopify Files permission before uploading images",
      } satisfies ImageUploadResponse,
      { status: 403 },
    );
  }

  try {
    const formData = await request.formData();
    const value = formData.get("image");
    if (!(value instanceof File)) throw new Error("Select an image to upload");
    const result = await uploadOfferImageToShopify({
      admin,
      file: value,
      alt: String(formData.get("alt") ?? "Upsell offer image"),
    });
    return Response.json({
      ok: true,
      message: result.imageUrl
        ? "Image uploaded to Shopify"
        : "Shopify is processing the image",
      fileId: result.fileId,
      ...(result.imageUrl ? { imageUrl: result.imageUrl } : {}),
      processing: !result.imageUrl,
      attempt: 0,
    } satisfies ImageUploadResponse);
  } catch (error) {
    return Response.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "Unable to upload image",
      } satisfies ImageUploadResponse,
      { status: 400 },
    );
  }
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  if (!hasFileWriteAccess(session.scope)) {
    return Response.json(
      {
        ok: false,
        message: "Shopify Files permission is required",
      } satisfies ImageUploadResponse,
      { status: 403 },
    );
  }

  const url = new URL(request.url);
  const fileId = url.searchParams.get("id");
  const attempt = Number(url.searchParams.get("attempt") ?? "0");
  if (!fileId?.startsWith("gid://shopify/MediaImage/")) {
    return Response.json(
      {
        ok: false,
        message: "A valid Shopify image ID is required",
      } satisfies ImageUploadResponse,
      { status: 400 },
    );
  }

  try {
    const result = await getShopifyImageStatus({ admin, fileId });
    if (result.imageUrl) {
      return Response.json({
        ok: true,
        message: "Image uploaded to Shopify",
        fileId,
        imageUrl: result.imageUrl,
        processing: false,
        attempt,
      } satisfies ImageUploadResponse);
    }
    if (attempt >= 20) {
      return Response.json(
        {
          ok: false,
          message:
            "Shopify is still processing this image. Wait a moment, then select or upload it again.",
          fileId,
        } satisfies ImageUploadResponse,
        { status: 408 },
      );
    }
    return Response.json({
      ok: true,
      message: "Shopify is processing the image",
      fileId,
      processing: true,
      attempt: attempt + 1,
    } satisfies ImageUploadResponse);
  } catch (error) {
    return Response.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to check the uploaded image",
      } satisfies ImageUploadResponse,
      { status: 400 },
    );
  }
};
