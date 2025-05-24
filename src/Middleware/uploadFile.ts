import { multipart } from "@nhttp/nhttp";

export const uploadDocument = multipart.upload({
  name: "verficationDocument",
  dest: "./uploads/verficationDocument",
  maxSize: "2mb",
  maxCount: 2,
  accept: ["pdf", "jpg", "jpeg", "png"],
  required: true,
  callback: (file) => {
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const extension = file.name.split(".").pop();
    file.filename = `${timestamp}_${randomSuffix}.${extension}`;
  }
});