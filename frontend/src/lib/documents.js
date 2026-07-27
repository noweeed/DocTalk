import { api } from "./api";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

export const documentsApi = {
  list: (filter) => api.get(`/api/documents${filter ? `?filter=${filter}` : ""}`),
  get: (id) => api.get(`/api/documents/${id}`),
  upload: (formData) => api.post("/api/documents", formData),
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
