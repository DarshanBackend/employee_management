import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';

export const s3 = new S3Client({
    region: process.env.S3_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY?.trim(),
        secretAccessKey: process.env.S3_SECRET_KEY?.trim(),
    },
});

export const publicUrlForKey = (key) => {
    const cdn = process.env.CDN_BASE_URL?.replace(/\/$/, '');
    if (cdn) return `${cdn}/${key}`;
    const bucket = process.env.S3_BUCKET_NAME;
    const region = process.env.S3_REGION || 'us-east-1';
    return `https://${bucket}.s3.${region}.amazonaws.com/${encodeURI(key)}`;
};

export const deleteS3File = async (key) => {
    try {
        if (!key) {
            throw new Error("S3 key is required to delete a file");
        }

        const command = new DeleteObjectCommand({
            Bucket: process.env.S3_BUCKET_NAME,
            Key: key,
        });

        await s3.send(command);

        console.log(`File deleted from S3: ${key}`);
        return true;
    } catch (error) {
        console.error("Failed to delete file from S3:", error.message);
        return false;
    }
};

export const cleanupUploadedIfAny = async (file) => {
    if (file?.key) {
        try {
            await s3.send(
                new DeleteObjectCommand({
                    Bucket: process.env.S3_BUCKET_NAME,
                    Key: file.key,
                })
            );
        } catch (e) {
            console.error('S3 cleanup failed:', e.message);
        }
    }
};
