import multer from "multer";
import sharp from "sharp";
import path from "path";
import dotenv from "dotenv";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";

dotenv.config();

const s3 = new S3Client({
  region: process.env.S3_REGION,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
});

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
});

export const uploadFile = async (file) => {
  if (!file) throw new Error("No file provided");

  const ext = path.extname(file.originalname).toLowerCase();

  let buffer = file.buffer;
  let contentType = file.mimetype;

  if (file.mimetype.startsWith("image/")) {
    const shouldConvert = ext === ".jfif" || file.mimetype === "application/octet-stream";
    if (shouldConvert) {
      buffer = await sharp(file.buffer).jpeg().toBuffer();
      contentType = "image/jpeg";
    }
  }

  const cleanFileName = file.originalname.replace(/\s+/g, "_");
  const fileName = `${Date.now()}_${cleanFileName}`;
  const key = `uploads/${fileName}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );

  return {
    url: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.S3_REGION}.amazonaws.com/${key}`,
    key,
  };
};

export const uploadPDF = async (file, folder = "uploads") => {
  if (!file) throw new Error("No file provided");

  const ext = path.extname(file.originalname).toLowerCase();
  if (ext !== ".pdf") {
    throw new Error("Only PDF files are allowed");
  }

  const cleanName = file.originalname.replace(/\s+/g, "_");
  const timestamp = Date.now();
  const fileName = `${timestamp}-${cleanName}`;
  const key = `${folder}/${fileName}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: key,
      Body: file.buffer,
      ContentType: "application/pdf",
    })
  );

  return {
    url: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.S3_REGION}.amazonaws.com/${key}`,
    key,
  };
};

export const deleteFileFromS3 = async (fileUrl) => {
  try {
    if (!fileUrl || typeof fileUrl !== "string") return;

    let key = null;
    if (fileUrl.includes(".amazonaws.com/")) {
      key = fileUrl.split(".amazonaws.com/")[1];
    } else if (fileUrl.includes("/uploads/")) {
      key = "uploads/" + fileUrl.split("/uploads/")[1];
    } else if (fileUrl.startsWith("uploads/")) {
      key = fileUrl;
    }

    if (!key) return;

    key = decodeURIComponent(key.split("?")[0]);

    await s3.send(
      new DeleteObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: key,
      })
    );
  } catch (err) {
    console.error("Error deleting from S3:", err.message);
  }
};

export const listBucketObjects = async () => {
  try {
    const data = await s3.send(
      new ListObjectsV2Command({
        Bucket: process.env.S3_BUCKET_NAME,
      })
    );
    if (!data.Contents) return [];
    return data.Contents.map((item) => ({
      key: item.Key,
      url: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.S3_REGION}.amazonaws.com/${item.Key}`,
      size: item.Size,
      lastModified: item.LastModified,
    }));
  } catch (error) {
    console.error("Error listing S3 objects:", error.message);
    throw error;
  }
};

export const deleteManyFromS3 = async (keys) => {
  try {
    if (!keys || !keys.length) return;
    const objects = keys.map((key) => ({ Key: key }));
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Delete: {
          Objects: objects,
          Quiet: true,
        },
      })
    );
  } catch (err) {
    console.error("Error deleting many files from S3:", err.message);
    throw err;
  }
};
