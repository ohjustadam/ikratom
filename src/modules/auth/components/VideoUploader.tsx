"use client";

import { useRef, useState, useTransition } from "react";
import {
  requestVideoUpload,
  setProfileVideoUrl,
} from "@/modules/auth/actions-video";

const MAX_MB = 100;
const ACCEPT = "video/mp4,video/quicktime,video/webm";

/**
 * Two-tab video input: "Paste URL" (YouTube / Vimeo) or "Upload file"
 * (Cloudflare R2 via presigned PUT). The component renders the URL
 * field for the parent form regardless of which tab is active so the
 * existing /account/character form continues to work — the upload
 * tab just rewrites the URL field's value after a successful upload.
 *
 * If the server reports R2 is not configured (uploadEnabled=false),
 * the tabs disappear and only the URL field is shown.
 */
export function VideoUploader({
  initialUrl,
  initialProvider,
  uploadEnabled,
  fieldName = "video_url",
}: {
  initialUrl: string;
  initialProvider: string | null;
  uploadEnabled: boolean;
  fieldName?: string;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [tab, setTab] = useState<"url" | "upload">(
    initialProvider === "r2" ? "upload" : "url"
  );
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError(null);
    setSuccess(null);
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`File is too large. Max ${MAX_MB} MB.`);
      return;
    }
    if (!ACCEPT.split(",").includes(file.type)) {
      setError("Only MP4, MOV, or WebM video files are accepted.");
      return;
    }

    // 1. Mint a presigned URL
    const presign = await requestVideoUpload({
      contentType: file.type,
      sizeBytes: file.size,
    });
    if ("error" in presign) {
      setError(presign.error);
      return;
    }

    // 2. PUT the file to R2 with progress (XHR — fetch can't stream
    //    upload progress in browsers yet).
    setProgress(0);
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", presign.uploadUrl);
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`Upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error("Network error during upload."));
      xhr.send(file);
    }).catch((e) => {
      setError(e.message);
      setProgress(null);
    });

    if (progress === null && !error) setProgress(100);

    // 3. Persist on the profile.
    startTransition(async () => {
      const r = await setProfileVideoUrl({ publicUrl: presign.publicUrl });
      if ("error" in r) {
        setError(r.error);
      } else {
        setUrl(presign.publicUrl);
        setSuccess("Uploaded. Save the form to keep it.");
        setProgress(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    });
  }

  // Hidden field that the parent <form> reads on submit.
  const hiddenField = (
    <input type="hidden" name={fieldName} value={url} />
  );

  if (!uploadEnabled) {
    return (
      <div>
        <input
          type="url"
          name={fieldName}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://youtu.be/…"
          maxLength={500}
          className="mt-2 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
      </div>
    );
  }

  return (
    <div className="mt-2">
      {hiddenField}

      <div className="flex gap-2 rounded-md border border-zinc-800 bg-zinc-950/40 p-1 text-xs">
        <TabBtn active={tab === "url"} onClick={() => setTab("url")}>
          Paste URL
        </TabBtn>
        <TabBtn active={tab === "upload"} onClick={() => setTab("upload")}>
          Upload file
        </TabBtn>
      </div>

      {tab === "url" && (
        <div className="mt-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://youtu.be/…"
            maxLength={500}
            className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          />
        </div>
      )}

      {tab === "upload" && (
        <div className="mt-2 space-y-2">
          <label
            className="flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-zinc-700 bg-zinc-950/40 p-6 text-center text-sm hover:border-emerald-500"
          >
            <span className="font-medium text-zinc-200">
              {pending || progress !== null ? "Uploading…" : "Choose a video file"}
            </span>
            <span className="mt-1 text-[11px] text-zinc-500">
              MP4 / MOV / WebM · up to {MAX_MB} MB
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT}
              disabled={pending || progress !== null}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
              className="hidden"
            />
          </label>

          {progress !== null && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}

          {url && (
            <p className="break-all rounded-md bg-zinc-950 px-3 py-2 text-[11px] text-zinc-400">
              Current: <span className="text-zinc-200">{url}</span>
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="mt-2 rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}
      {success && (
        <p className="mt-2 rounded-md border border-emerald-900/40 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-300">
          {success}
        </p>
      )}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded px-3 py-1.5 font-medium transition ${
        active ? "bg-emerald-500 text-zinc-950" : "text-zinc-400 hover:text-zinc-100"
      }`}
    >
      {children}
    </button>
  );
}
