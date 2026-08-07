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
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import ReactMarkdown from "react-markdown";
import { Document, Page } from "react-pdf";
import { Input } from "@/components/ui/input";
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
  const [numPages, setNumPages] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [flashPage, setFlashPage] = useState(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);

  const containerRef = useRef(null);
  const dragging = useRef(false);
  const chatEndRef = useRef(null);
  const titleInputRef = useRef(null);
  const pdfScrollRef = useRef(null);
  const pageRefs = useRef([]);

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
    if (!pdfScrollRef.current || numPages === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = pageRefs.current.indexOf(entry.target);
            if (idx >= 0) setPage(idx + 1);
            break;
          }
        }
      },
      { root: pdfScrollRef.current, threshold: 0.5 },
    );
    pageRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [numPages, zoom, status]);

  useEffect(() => {
    let cancelled = false;
    let pollTimer;

    async function init() {
      try {
        pageRefs.current = [];
        setNumPages(0);
        setPage(1);
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

  const saveTitle = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    try {
      await documentsApi.update(id, { title: trimmed });
      setDoc((d) => (d ? { ...d, title: trimmed } : d));
      toast.success("Title saved");
    } catch (err) {
      setTitle(doc?.title ?? "");
      toast.error(err.message || "Failed to save title");
    }
  };

  const saveRename = async () => {
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    try {
      await documentsApi.update(id, { title: trimmed });
      setTitle(trimmed);
      setDoc((d) => (d ? { ...d, title: trimmed } : d));
      toast.success("Renamed");
      setRenameOpen(false);
    } catch (err) {
      toast.error(err.message || "Failed to rename");
    }
  };

  const toggleStar = async () => {
    const next = !doc?.isStarred;
    try {
      await documentsApi.update(id, { isStarred: next });
      setDoc((d) => (d ? { ...d, isStarred: next } : d));
      toast.success(next ? "Starred" : "Unstarred");
    } catch (err) {
      toast.error(err.message || "Failed to update star");
    }
  };

  const downloadDoc = async () => {
    try {
      const blob = await documentsApi.getFileBlob(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${doc?.title || "document"}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err.message || "Failed to download");
    }
  };

  const trashDoc = async () => {
    try {
      await documentsApi.trash(id);
      toast.success("Moved to trash");
      navigate("/recent");
    } catch (err) {
      toast.error(err.message || "Failed to delete");
    }
  };

  const jumpToPage = (p) => {
    setPage(p);
    setFlashPage(p);
    const target = pageRefs.current[p - 1];
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setTimeout(() => setFlashPage(null), 900);
  };

  const scrollToPage = (p) => {
    const target = pageRefs.current[p - 1];
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  if (status === "loading") {
    return (
      <div className="flex h-screen flex-col bg-background">
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
          <Skeleton className="h-9 w-9 rounded-md" />
          <Skeleton className="h-4 w-1/3" />
          <div className="ml-auto flex items-center gap-2">
            <Skeleton className="h-9 w-9 rounded-md" />
            <Skeleton className="h-9 w-9 rounded-md" />
          </div>
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-3 border-b border-border px-4 py-2">
              <Skeleton className="h-7 w-7 rounded" />
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-7 w-7 rounded" />
              <div className="mx-2 h-4 w-px bg-border" />
              <Skeleton className="h-7 w-7 rounded" />
              <Skeleton className="h-3.5 w-10" />
              <Skeleton className="h-7 w-7 rounded" />
            </div>
            <div className="flex-1 bg-muted/30 p-4">
              <Skeleton className="h-full w-full rounded-lg" />
            </div>
          </div>
          <div className="hidden w-[400px] shrink-0 flex-col border-l border-border bg-surface p-4 md:flex">
            <Skeleton className="h-8 w-48 rounded-full" />
            <div className="mt-6 space-y-4">
              <div className="flex justify-end">
                <Skeleton className="h-10 w-2/3 rounded-2xl rounded-br-sm" />
              </div>
              <div className="flex gap-2.5">
                <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
                <Skeleton className="h-16 w-3/4" />
              </div>
              <div className="flex gap-2.5">
                <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
                <Skeleton className="h-20 w-4/5" />
              </div>
            </div>
            <div className="mt-auto space-y-3">
              <Skeleton className="h-12 w-full rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (status === "processing") {
    return (
      <div className="flex h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-8">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <FileText className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">
                {doc?.title || "Processing your document..."}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Processing document — this should take just a moment.
              </div>
            </div>
          </div>
          <div className="mt-5 h-2 w-full overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuenow={100} aria-valuemin={0} aria-valuemax={100}>
            <div
              className="h-full w-full rounded-full gradient-primary animate-pulse"
              style={{ width: "100%" }}
            />
          </div>
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
          ref={titleInputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.target.blur();
            }
          }}
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
            <DropdownMenuItem
              onSelect={() => {
                setRenameValue(title);
                setRenameOpen(true);
              }}
            >
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={toggleStar}>{doc?.isStarred ? "Unstar" : "Star"}</DropdownMenuItem>
            <DropdownMenuItem onSelect={downloadDoc}>Download</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setDeleteOpen(true)} className="text-destructive focus:text-destructive">
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div ref={containerRef} className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col bg-background">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs text-muted-foreground">
            <button
              onClick={() => scrollToPage(Math.max(1, page - 1))}
              className="grid h-7 w-7 place-items-center rounded hover:bg-accent hover:text-foreground"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="tabular-nums">Page {page} / {numPages || doc?.pageCount || "?"}</span>
            <button
              onClick={() => scrollToPage(Math.min(numPages || doc?.pageCount || 999, page + 1))}
              className="grid h-7 w-7 place-items-center rounded hover:bg-accent hover:text-foreground"
              aria-label="Next page"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
            <div className="mx-2 h-4 w-px bg-border" />
            <button
              onClick={() => setZoom((z) => Math.max(0.25, +(z - 0.1).toFixed(2)))}
              className="grid h-7 w-7 place-items-center rounded hover:bg-accent hover:text-foreground"
              aria-label="Zoom out"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="tabular-nums">{Math.round(zoom * 100)}%</span>
            <button
              onClick={() => setZoom((z) => Math.min(3, +(z + 0.1).toFixed(2)))}
              className="grid h-7 w-7 place-items-center rounded hover:bg-accent hover:text-foreground"
              aria-label="Zoom in"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>

          <div ref={pdfScrollRef} className="flex-1 overflow-y-auto bg-muted/30">
            {pdfUrl && (
              <Document
                file={pdfUrl}
                onLoadSuccess={({ numPages: n }) => setNumPages(n)}
                loading={
                  <div className="grid h-full min-h-[300px] place-items-center text-sm text-muted-foreground">
                    Loading PDF…
                  </div>
                }
              >
                <div className="flex flex-col items-center gap-4 py-4">
                  {Array.from({ length: numPages || 0 }, (_, i) => (
                    <div
                      key={i + 1}
                      ref={(el) => (pageRefs.current[i] = el)}
                      className={cn(
                        "shrink-0 rounded-sm bg-white shadow-sm",
                        flashPage === i + 1 && "ring-2 ring-primary",
                      )}
                    >
                      <Page
                        pageNumber={i + 1}
                        scale={zoom}
                        renderTextLayer={false}
                        renderAnnotationLayer={false}
                        className="max-w-full"
                        loading={
                          <div className="grid h-[300px] w-[600px] max-w-full place-items-center text-sm text-muted-foreground">
                            Loading page…
                          </div>
                        }
                      />
                    </div>
                  ))}
                </div>
              </Document>
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

      <AlertDialog open={renameOpen} onOpenChange={setRenameOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rename document</AlertDialogTitle>
            <AlertDialogDescription>Enter a new title for this document.</AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                saveRename();
              }
            }}
            placeholder="Document title"
            autoFocus
            onFocus={(e) => e.target.select()}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={saveRename} disabled={!renameValue.trim()}>
              Save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete document?</AlertDialogTitle>
            <AlertDialogDescription>
              Move "{title}" to trash? You can restore it from the trash within 30 days.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={trashDoc}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
                    <div className="text-sm leading-relaxed text-foreground">
                      <ReactMarkdown
                        components={{
                          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                          strong: ({ children }) => (
                            <strong className="font-semibold">{children}</strong>
                          ),
                          ul: ({ children }) => (
                            <ul className="mb-2 list-disc pl-5">{children}</ul>
                          ),
                          ol: ({ children }) => (
                            <ol className="mb-2 list-decimal pl-5">{children}</ol>
                          ),
                          li: ({ children }) => <li className="mb-1">{children}</li>,
                          code: ({ children }) => (
                            <code className="rounded bg-muted px-1 py-0.5 text-sm">{children}</code>
                          ),
                        }}
                      >
                        {m.text}
                      </ReactMarkdown>
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
