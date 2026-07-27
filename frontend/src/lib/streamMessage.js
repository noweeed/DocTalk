const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

export async function streamMessage(conversationId, question, { onToken, onDone, onError }) {
  const token = localStorage.getItem("token");
  const res = await fetch(
    `${API_URL}/api/conversations/${conversationId}/messages`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ question }),
    },
  );

  if (res.status === 403) {
    const err = await res.json().catch(() => ({}));
    onError({ status: 403, message: err.message || "Question limit reached" });
    return;
  }
  if (!res.ok) {
    onError({ status: res.status, message: "Failed to send message" });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop();

    for (const raw of frames) {
      const line = raw.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;

      let payload;
      try {
        payload = JSON.parse(line.slice(6));
      } catch {
        continue;
      }

      if ("error" in payload) {
        onError({ message: payload.error });
        return;
      }
      if ("done" in payload) {
        onDone(payload.matchedChunks || []);
        return;
      }
      if ("content" in payload) {
        onToken(payload.content);
      }
    }
  }
}
