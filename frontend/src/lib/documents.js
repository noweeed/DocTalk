import { api } from "./api";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

export const documentsApi = {
  list: (filter) => api.get(`/api/documents${filter ? `?filter=${filter}` : ""}`),
  get: (id) => api.get(`/api/documents/${id}`),
  upload: (formData) => api.post("/api/documents", formData),
  uploadWithProgress: (formData, onProgress) =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_URL}/api/documents`);
      xhr.setRequestHeader("Authorization", `Bearer ${localStorage.getItem("token")}`);
      if (onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && e.total > 0) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        };
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch {
            resolve(xhr.responseText);
          }
        } else {
          const err = new Error("Upload failed. Try again.");
          err.status = xhr.status;
          reject(err);
        }
      };
      xhr.onerror = () => reject(new Error("Upload failed. Try again."));
      xhr.send(formData);
    }),
  update: (id, body) => api.patch(`/api/documents/${id}`, body),
  trash: (id) => api.del(`/api/documents/${id}`),
  restore: (id) => api.post(`/api/documents/${id}/restore`),
  permanentDelete: (id) => api.del(`/api/documents/${id}/permanent`),

  getFileBlob: async (id) => {
    const res = await fetch(`${API_URL}/api/documents/${id}/file`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
    });
    if (!res.ok) throw new Error("Failed to load PDF");
    return res.blob();
  },
};
