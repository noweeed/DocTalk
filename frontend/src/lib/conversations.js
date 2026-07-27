import { api } from "./api";

export const conversationsApi = {
  create: (documentId) => api.post("/api/conversations", { documentId }),
  get: (id) => api.get(`/api/conversations/${id}`),
  list: () => api.get("/api/conversations"),
};
