import { Link, useNavigate, useParams } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  MoreHorizontal,
  Send,
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
  FileText,
  Loader2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { documentsApi } from "@/lib/documents";
import { conversationsApi } from "@/lib/conversations";
import { streamMessage } from "@/lib/streamMessage";

const starters = [
  "Summarize this document",
];

const formatPageLabel = (page) => {
  const value = String(page);
  if (value.includes("-")) {
    const [min, max] = value.split("-");
    return `Pages #${min}-#${max}`;
  }
  return `Page #${value}`;
};

export default function DocumentChat() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [doc, setDoc] = useState(null);
  const [status, setStatus] = useState("loading");
  const [pdfUrl, setPdfUrl] = useState(null);

  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);

  const [title, setTitle] = useState("");
  const [chatOpen, setChatOpen] = useState(true);
  const [chatWidth, setChatWidth] = useState(400);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [flashPage, setFlashPage] = useState(null);

  const containerRef = useRef(null);
  const dragging = useRef(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const w = rect.right - e.clientX;
      setChatWidth(Math.max(320, Math.min(720, w)));
    };
    const onUp = () => (dragging.current = false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  useEffect(() => {
    let cancelled = false;
    let pollTimer;

    async function init() {
      try {
        const docData = await documentsApi.get(id);
        if (cancelled) return;
        setDoc(docData);
        setTitle(docData.title);

        if (docData.status === "ready") {
          setStatus("ready");
          await loadPdfAndConversation(docData);
        } else if (docData.status === "failed") {
          setStatus("failed");
        } else {
          setStatus("processing");
          pollTimer = setInterval(async () => {
            try {
              const updated = await documentsApi.get(id);
              if (cancelled) return;
              if (updated.status === "ready") {
                clearInterval(pollTimer);
                setDoc(updated);
                setTitle(updated.title);
                setStatus("ready");
                await loadPdfAndConversation(updated);
              } else if (updated.status === "failed") {
                clearInterval(pollTimer);
                setStatus("failed");
              }
            } catch {
              if (!cancelled) clearInterval(pollTimer);
            }
          }, 2000);
        }
      } catch {
        if (!cancelled) setStatus("failed");
      }
    }

    init();

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [id]);

  async function loadPdfAndConversation(docData) {
    const blob = await documentsApi.getFileBlob(docData._id);
    const url = URL.createObjectURL(blob);
    setPdfUrl(url);

    const convList = await conversationsApi.list();
    const existing = convList.find((c) => c.documentIds.includes(docData._id));
    if (existing) {
      setConversationId(existing._id);
      const full = await conversationsApi.get(existing._id);
      setMessages(
        full.messages.map((m) => ({
          id: m._id,
          role: m.role,
          text: m.content,
          streaming: false,
          citations: (m.citations || []).map((c) => ({
            page: c.pageNumber ?? c.page,
            chunkId: c.chunkIndex,
            score: c.score,
            note: c.note,
          })),
        })),
      );
    } else {
      const created = await conversationsApi.create(docData._id);
      setConversationId(created._id);
    }
  }

  async function ask(content) {
    if (!content.trim() || streaming || !conversationId) return;

    const userMsg = { id: crypto.randomUUID(), role: "user", text: content };
    const assistantId = crypto.randomUUID();

    setMessages((m) => [
      ...m,
      userMsg,
      { id: assistantId, role: "assistant", text: "", streaming: true, citations: [] },
    ]);
    setStreaming(true);
    setInput("");

    await streamMessage(conversationId, content, {
      onToken: (text) =>
        setMessages((m) =>
          m.map((msg) => (msg.id === assistantId ? { ...msg, text: msg.text + text } : msg)),
        ),
      onDone: (matchedChunks) =>
        setMessages((m) =>
          m.map((msg) =>
            msg.id === assistantId
              ? {
                  ...msg,
                  streaming: false,
                  citations: matchedChunks.map((c) => ({
                    page: c.pageNumber ?? c.page,
                    chunkId: c.chunkIndex,
                    score: c.score,
                    note: c.note,
                  })),
                }
              : msg,
          ),
        ),
      onError: (err) => {
        if (err.status === 403)
          toast.error("Monthly question limit reached — upgrade to keep asking.");
        else toast.error(err.message || "Something went wrong");
        setMessages((m) =>
          m.map((msg) =>
            msg.id === assistantId
              ? { ...msg, streaming: false, text: msg.text || "Failed to get an answer." }
              : msg,
          ),
        );
      },
    });
    setStreaming(false);
  }

  const jumpToPage = (p) => {
    setPage(p);
    setFlashPage(p);
    setTimeout(() => setFlashPage(null), 900);
  };

  if (status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (status === "processing") {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" />
          <h3 className="mt-4 text-lg font-medium text-foreground">Processing your document...</h3>
          <p className="mt-1 text-sm text-muted-foreground">This should take just a moment.</p>
        </div>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center">
          <h3 className="text-lg font-medium text-foreground">Failed to load document</h3>
          <p className="mt-1 text-sm text-muted-foreground">The document could not be processed.</p>
          <button
            onClick={() => navigate("/recent")}
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <ArrowLeft className="h-4 w-4" /> Go back
          </button>
        </div>
      </div>
    );
  }

  const isStreaming = streaming;

  return (
    <div className="flex h-screen flex-col">
      <div className="flex h-14 items-center gap-2 border-b border-border bg-background/80 pl-14 pr-3 backdrop-blur-md sm:pl-4">
        <button
          onClick={() => navigate("/recent")}
          className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="min-w-0 flex-1 truncate rounded-md bg-transparent px-2 py-1 text-sm font-medium text-foreground hover:bg-accent focus:bg-accent focus:outline-none"
        />
        <button
          onClick={() => setChatOpen((v) => !v)}
          aria-label={chatOpen ? "Hide chat" : "Show chat"}
          className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {chatOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>Rename</DropdownMenuItem>
            <DropdownMenuItem>Star</DropdownMenuItem>
            <DropdownMenuItem>Download</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive">Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div ref={containerRef} className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col bg-background">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs text-muted-foreground">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="grid h-7 w-7 place-items-center rounded hover:bg-accent hover:text-foreground"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="tabular-nums">Page {page} / {doc?.pageCount ?? "?"}</span>
            <button
              onClick={() => setPage((p) => Math.min(doc?.pageCount ?? 999, p + 1))}
              className="grid h-7 w-7 place-items-center rounded hover:bg-accent hover:text-foreground"
              aria-label="Next page"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
            <div className="mx-2 h-4 w-px bg-border" />
            <button
              onClick={() => setZoom((z) => Math.max(50, z - 10))}
              className="grid h-7 w-7 place-items-center rounded hover:bg-accent hover:text-foreground"
              aria-label="Zoom out"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="tabular-nums">{zoom}%</span>
            <button
              onClick={() => setZoom((z) => Math.min(200, z + 10))}
              className="grid h-7 w-7 place-items-center rounded hover:bg-accent hover:text-foreground"
              aria-label="Zoom in"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-auto bg-muted/30">
            {pdfUrl && (
              <iframe
                key={`${page}`}
                src={`${pdfUrl}#page=${page}`}
                className="h-full w-full"
                title={title}
              />
            )}
          </div>
        </div>

        {chatOpen && (
          <div
            onMouseDown={() => (dragging.current = true)}
            className="hidden w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/60 md:block"
            aria-label="Resize chat panel"
            role="separator"
          />
        )}

        {chatOpen && (
          <aside
            style={{ width: chatWidth }}
            className="hidden shrink-0 flex-col border-l border-border bg-surface md:flex"
          >
            <ChatPanel
              messages={messages}
              streaming={isStreaming}
              input={input}
              setInput={setInput}
              ask={ask}
              jumpToPage={jumpToPage}
              chatEndRef={chatEndRef}
              docTitle={doc?.title}
            />
          </aside>
        )}
      </div>

      {chatOpen && (
        <div className="fixed inset-x-0 bottom-0 top-14 z-20 flex flex-col border-t border-border bg-surface md:hidden">
          <ChatPanel
            messages={messages}
            streaming={isStreaming}
            input={input}
            setInput={setInput}
            ask={ask}
            jumpToPage={jumpToPage}
            chatEndRef={chatEndRef}
            docTitle={doc?.title}
          />
        </div>
      )}
    </div>
  );
}

function ChatPanel({ messages, streaming, input, setInput, ask, jumpToPage, chatEndRef, docTitle }) {
  return (
    <>
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
        <span className="inline-flex max-w-[220px] shrink-0 items-center gap-1.5 rounded-full border border-border bg-accent/50 py-1 pl-2 pr-1 text-xs text-foreground">
          <FileText className="h-3 w-3 text-primary" />
          <span className="truncate">{docTitle || "Current document"}</span>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
        {messages.length === 0 && !streaming ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <h3 className="mt-4 text-base font-semibold text-foreground">Ask anything about this document</h3>
            <p className="mt-1 max-w-xs text-sm text-muted-foreground">
              Answers come back with cited pages you can click.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              {starters.map((s) => (
                <button
                  key={s}
                  onClick={() => ask(s)}
                  disabled={streaming}
                  className="rounded-full border border-border bg-card px-3.5 py-1.5 text-xs text-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">
                    {m.text}
                  </div>
                </div>
              ) : (
                <div key={m.id} className="flex gap-2.5">
                  <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                    <Sparkles className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                      {m.text}
                      {m.streaming && (
                        <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-primary" />
                      )}
                    </div>
                    {!m.streaming && m.citations?.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {m.citations.map((c, i) =>
                          c.note === "full document" ? (
                            <span
                              key={i}
                              className="rounded-md border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground"
                            >
                              {formatPageLabel(c.page)}
                            </span>
                          ) : (
                            <button
                              key={i}
                              onClick={() => jumpToPage(c.page)}
                              className="rounded-md border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
                            >
                              {formatPageLabel(c.page)}
                            </button>
                          ),
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ),
            )}
            {streaming && messages.length > 0 && !messages[messages.length - 1]?.streaming && (
              <div className="flex gap-2.5">
                <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                  <Sparkles className="h-3.5 w-3.5" />
                </div>
                <div className="flex items-center gap-1 pt-2">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" />
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        className="border-t border-border p-3"
      >
        <div className="flex items-end gap-2 rounded-xl border border-border bg-card p-2 focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/20">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask(input);
              }
            }}
            placeholder="Ask a question about this document…"
            rows={1}
            disabled={streaming}
            className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent px-1.5 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || streaming}
            aria-label="Send"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg gradient-primary text-primary-foreground shadow-glow transition-opacity disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </form>
    </>
  );
}
