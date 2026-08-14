type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

const ALLOWED_IMAGE_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

type ShopifyUserError = { field?: string[] | null; message: string };

const userErrorMessage = (errors: ShopifyUserError[] | undefined) =>
  errors?.map((error) => error.message).join("; ") || null;

export const validateOfferImage = (file: File) => {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error("Upload a JPG, PNG, WEBP, or GIF image");
  }
  if (file.size === 0) throw new Error("The selected image is empty");
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("The image must be 10 MB or smaller");
  }
};

export const uploadOfferImageToShopify = async ({
  admin,
  file,
  alt,
}: {
  admin: AdminGraphqlClient;
  file: File;
  alt: string;
}) => {
  validateOfferImage(file);

  const stagedResponse = await admin.graphql(
    `#graphql
      mutation CreateOfferImageUpload($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets {
            url
            resourceUrl
            parameters {
              name
              value
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      variables: {
        input: [
          {
            filename: file.name.replace(/[^a-zA-Z0-9._-]/g, "-"),
            mimeType: file.type,
            resource: "IMAGE",
            httpMethod: "PUT",
          },
        ],
      },
    },
  );
  const stagedJson = (await stagedResponse.json()) as {
    data?: {
      stagedUploadsCreate?: {
        stagedTargets?: Array<{
          url: string;
          resourceUrl: string;
          parameters: Array<{ name: string; value: string }>;
        }>;
        userErrors?: ShopifyUserError[];
      };
    };
  };
  const stagedResult = stagedJson.data?.stagedUploadsCreate;
  const stagedError = userErrorMessage(stagedResult?.userErrors);
  if (stagedError) throw new Error(stagedError);
  const target = stagedResult?.stagedTargets?.[0];
  if (!target) throw new Error("Shopify did not create an upload target");

  const uploadHeaders = new Headers();
  for (const parameter of target.parameters) {
    uploadHeaders.set(parameter.name, parameter.value);
  }
  const uploadResponse = await fetch(target.url, {
    method: "PUT",
    headers: uploadHeaders,
    body: Buffer.from(await file.arrayBuffer()),
  });
  if (!uploadResponse.ok) {
    throw new Error(`Shopify image upload failed (${uploadResponse.status})`);
  }

  const createResponse = await admin.graphql(
    `#graphql
      mutation CreateOfferImageFile($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files {
            id
            fileStatus
            ... on MediaImage {
              image {
                url
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      variables: {
        files: [
          {
            originalSource: target.resourceUrl,
            contentType: "IMAGE",
            alt: alt.trim().slice(0, 512) || "Upsell offer image",
          },
        ],
      },
    },
  );
  const createJson = (await createResponse.json()) as {
    data?: {
      fileCreate?: {
        files?: Array<{
          id: string;
          fileStatus: string;
          image?: { url: string } | null;
        }>;
        userErrors?: ShopifyUserError[];
      };
    };
  };
  const createResult = createJson.data?.fileCreate;
  const createError = userErrorMessage(createResult?.userErrors);
  if (createError) throw new Error(createError);
  const createdFile = createResult?.files?.[0];
  if (!createdFile) throw new Error("Shopify did not create the image file");

  return {
    fileId: createdFile.id,
    fileStatus: createdFile.fileStatus,
    imageUrl: createdFile.image?.url ?? null,
  };
};

export const getShopifyImageStatus = async ({
  admin,
  fileId,
}: {
  admin: AdminGraphqlClient;
  fileId: string;
}) => {
  const response = await admin.graphql(
    `#graphql
      query OfferImageFileStatus($id: ID!) {
        node(id: $id) {
          ... on MediaImage {
            id
            fileStatus
            fileErrors {
              message
            }
            image {
              url
            }
          }
        }
      }
    `,
    { variables: { id: fileId } },
  );
  const json = (await response.json()) as {
    data?: {
      node?: {
        id: string;
        fileStatus: string;
        fileErrors: Array<{ message: string }>;
        image?: { url: string } | null;
      } | null;
    };
  };
  const file = json.data?.node;
  if (!file) throw new Error("The uploaded Shopify image could not be found");
  if (file.fileStatus === "FAILED") {
    throw new Error(
      file.fileErrors.map((error) => error.message).join("; ") ||
        "Shopify could not process the image",
    );
  }
  return {
    fileId: file.id,
    fileStatus: file.fileStatus,
    imageUrl: file.image?.url ?? null,
  };
};
