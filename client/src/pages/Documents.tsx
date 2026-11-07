import { useRef, useState, type DragEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Trash2, UploadCloud } from "lucide-react";
import { api, downloadFile } from "../lib/api";
import { useUser } from "../lib/auth";
import { fmtBytes, fmtDate } from "../lib/format";
import type { DocumentInfo } from "../lib/types";
import { Badge, Button, Card, EmptyState, ErrorBox, PageHeader, QueryState, cx } from "../components/ui";

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = ".pdf,.docx,.doc";

// Same rules as the server, checked first so people get an answer instantly.
// The server still checks the file's real contents.
function precheck(file: File) {
  if (!/\.(pdf|docx|doc)$/i.test(file.name)) return "Only PDF and Word files (.pdf, .docx, .doc) are accepted.";
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_BYTES) return `That file is ${fmtBytes(file.size)}. The limit is 5 MB.`;
  return null;
}

export function DocumentsPage() {
  const user = useUser();
  const qc = useQueryClient();
  const docs = useQuery({ queryKey: ["documents", "mine"], queryFn: () => api.get<{ items: DocumentInfo[] }>("/documents").then((r) => r.items) });
  // Which card the last upload came from, so its messages show in that card.
  const [lastKind, setLastKind] = useState<"RESUME" | "OTHER">("RESUME");
  const [localError, setLocalError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<unknown>(null);

  const upload = useMutation({
    mutationFn: ({ file, kind }: { file: File; kind: "RESUME" | "OTHER" }) => {
      const form = new FormData();
      form.append("kind", kind);
      form.append("file", file);
      return api.upload<{ document: DocumentInfo; replaced: boolean }>("/documents", form);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["documents", "mine"] }),
  });
  const remove = useMutation({
    mutationFn: (d: DocumentInfo) => api.del(`/documents/${d.id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["documents", "mine"] }),
  });

  const send = (file: File | undefined, kind: "RESUME" | "OTHER") => {
    if (!file) return;
    const problem = precheck(file);
    setLastKind(kind);
    setLocalError(problem);
    upload.reset();
    if (!problem) upload.mutate({ file, kind });
  };

  const resume = docs.data?.find((d) => d.kind === "RESUME");
  const others = docs.data?.filter((d) => d.kind === "OTHER") ?? [];

  return (
    <>
      <PageHeader
        title={user.role === "STUDENT" ? "My resume" : "My documents"}
        subtitle={user.role === "STUDENT" ? "Your mentor and the institute's admins can see what you upload here." : "Files you've uploaded. Admins can see them."}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Resume">
          <DropZone onFile={(f) => send(f, "RESUME")} busy={upload.isPending && upload.variables?.kind === "RESUME"} label={resume ? "Upload a new version (replaces the current one)" : "Upload your resume"} />
          {lastKind === "RESUME" && <UploadMessages localError={localError} error={upload.error} replaced={upload.data?.replaced} />}
          <QueryState query={docs}>
            {() => (resume ? <DocRow doc={resume} onDownload={setDownloadError} onDelete={() => confirm("Delete your resume?") && remove.mutate(resume)} /> : <p className="mt-3 text-sm text-muted">No resume uploaded yet.</p>)}
          </QueryState>
        </Card>

        <Card title="Other documents" actions={<span className="text-xs text-muted">Certificates, ID proofs… up to 10</span>}>
          <DropZone onFile={(f) => send(f, "OTHER")} busy={upload.isPending && upload.variables?.kind === "OTHER"} label="Add a document" compact />
          {lastKind === "OTHER" && <UploadMessages localError={localError} error={upload.error} />}
          {others.length === 0 ? (
            <EmptyState title="Nothing here yet" />
          ) : (
            <div className="mt-2">
              {others.map((d) => (
                <DocRow key={d.id} doc={d} onDownload={setDownloadError} onDelete={() => confirm(`Delete ${d.originalName}?`) && remove.mutate(d)} />
              ))}
            </div>
          )}
        </Card>
      </div>
      <div className="mt-3">
        <ErrorBox error={remove.error ?? downloadError} />
      </div>
    </>
  );
}

function UploadMessages({ localError, error, replaced }: { localError: string | null; error: unknown; replaced?: boolean }) {
  return (
    <div className="mt-3 space-y-2">
      {localError && <p className="text-sm text-bad" role="alert">{localError}</p>}
      <ErrorBox error={error} />
      {replaced && <p className="text-sm text-good" role="status">Resume updated. The old version was removed.</p>}
    </div>
  );
}

function DocRow({ doc, onDelete, onDownload }: { doc: DocumentInfo; onDelete: () => void; onDownload: (err: unknown) => void }) {
  return (
    <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <FileText className="size-5 shrink-0 text-brand" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{doc.originalName}</p>
          <p className="text-xs text-muted">
            {fmtBytes(doc.sizeBytes)} · uploaded {fmtDate(doc.createdAt)} {doc.mimeType === "application/pdf" ? <Badge>PDF</Badge> : <Badge>Word</Badge>}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button size="sm" variant="ghost" aria-label={`Download ${doc.originalName}`} onClick={() => downloadFile(`/documents/${doc.id}/download`, doc.originalName).catch(onDownload)}>
          <Download className="size-4" />
        </Button>
        <Button size="sm" variant="ghost" aria-label={`Delete ${doc.originalName}`} onClick={onDelete}>
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function DropZone({ onFile, busy, label, compact }: { onFile: (f: File | undefined) => void; busy: boolean; label: string; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    onFile(e.dataTransfer.files[0]);
  };
  return (
    <div
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      className={cx("flex flex-col items-center justify-center rounded-lg border-2 border-dashed text-center", compact ? "px-4 py-4" : "px-4 py-8", over ? "border-brand bg-brand-soft" : "border-line")}
    >
      {!compact && <UploadCloud className="mb-2 size-8 text-faint" />}
      <p className="text-sm font-medium">{label}</p>
      <p className="mb-3 text-xs text-muted">PDF or Word, up to 5 MB. Drag it here or</p>
      <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={(e) => (onFile(e.target.files?.[0]), (e.target.value = ""))} />
      <Button size="sm" variant="secondary" loading={busy} onClick={() => input.current?.click()}>
        Choose a file
      </Button>
    </div>
  );
}
