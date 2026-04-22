"use client";

import { useState, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { UploadCloud, File, FileText, X, AlertCircle, Loader2, CheckCircle2 } from "lucide-react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  requisitionId: string;
  onSuccess: () => void;
  onDuplicatesDetected?: (count: number) => void;
}

interface UploadedFile {
  file: File;
  id: string;
  progress: number;
  status: "pending" | "uploading" | "success" | "error";
  errorMessage?: string;
}

export function UploadResumesModal({ isOpen, onClose, requisitionId, onSuccess, onDuplicatesDetected }: Props) {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [duplicatesDetected, setDuplicatesDetected] = useState<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(Array.from(e.dataTransfer.files));
    }
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(Array.from(e.target.files));
    }
    // reset input so the same files can be selected again if needed
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const addFiles = (newFiles: File[]) => {
    const validFiles = newFiles.filter(f => 
      f.type === "application/pdf" || 
      f.type === "application/zip" || 
      f.type === "application/x-zip-compressed" || 
      f.name.toLowerCase().endsWith(".pdf") || 
      f.name.toLowerCase().endsWith(".zip")
    );
    
    setFiles(prev => [
      ...prev,
      ...validFiles.map(file => ({
        file,
        id: Math.random().toString(36).substring(7),
        progress: 0,
        status: "pending" as const
      }))
    ]);
  };

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const handleUpload = async () => {
    if (files.length === 0) return;
    
    setIsUploading(true);
    setGlobalError(null);
    
    try {
      const formData = new FormData();
      files.forEach(f => {
        if (f.status === "pending" || f.status === "error") {
          formData.append("files", f.file);
        }
      });
      
      const res = await fetch(`/api/requisitions/${requisitionId}/upload-profiles`, {
        method: "POST",
        body: formData,
      });
      
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(error.error || "Failed to process the uploaded files.");
      }
      
      const data = await res.json();
      const dupCount: number = data.duplicatesDetected ?? 0;
      setDuplicatesDetected(dupCount);
      setFiles(prev => prev.map(f => ({ ...f, status: "success", progress: 100 })));
      onSuccess();

      if (dupCount > 0) {
        // Stay open to show the amber duplicate alert — user decides when to close
      } else {
        setTimeout(() => {
          onClose();
          setFiles([]);
        }, 1500);
      }
      
    } catch (err: any) {
      setGlobalError(err.message || "An unexpected error occurred during upload.");
      setFiles(prev => prev.map(f => f.status === "pending" ? { ...f, status: "error", errorMessage: "Upload failed" } : f));
    } finally {
      setIsUploading(false);
    }
  };

  function handleClose() {
    if (isUploading) return;
    setFiles([]);
    setGlobalError(null);
    setDuplicatesDetected(0);
    onClose();
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-xl">Upload Resumes or ZIP</DialogTitle>
        </DialogHeader>
        
        <div className="py-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Upload candidate resumes directly to begin analysis. Supporting <b>PDFs</b> and <b>ZIP files</b> containing multiple PDFs.
          </p>

          <div 
            className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center transition-colors cursor-pointer text-center ${
              isDragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/50"
            }`}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input 
              type="file" 
              multiple 
              accept=".pdf,.zip,application/pdf,application/zip,application/x-zip-compressed" 
              className="hidden" 
              ref={fileInputRef}
              onChange={handleFileInput}
            />
            
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <UploadCloud className="h-6 w-6 text-primary" />
            </div>
            <p className="text-sm font-medium text-foreground mb-1">
              Click to upload or drag and drop
            </p>
            <p className="text-xs text-muted-foreground">
              PDF or ZIP up to 50MB
            </p>
          </div>

          {duplicatesDetected > 0 && (
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-sm text-amber-400 flex items-center justify-between gap-3">
              <span>⚠ {duplicatesDetected} duplicate candidate{duplicatesDetected === 1 ? "" : "s"} detected</span>
              <button
                className="text-xs font-medium underline underline-offset-2 hover:text-amber-300 transition-colors shrink-0"
                onClick={() => { onDuplicatesDetected?.(duplicatesDetected); handleClose(); }}
              >
                Review now
              </button>
            </div>
          )}

          {globalError && (
            <div className="bg-destructive/10 text-destructive text-sm px-4 py-3 rounded-md flex items-start gap-2">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <p>{globalError}</p>
            </div>
          )}

          {files.length > 0 && (
            <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Selected Files ({files.length})
              </p>
              {files.map(f => (
                <div key={f.id} className="flex items-center gap-3 bg-muted/30 border border-border p-3 rounded-lg">
                  {f.file.name.toLowerCase().endsWith(".zip") ? (
                    <File className="h-5 w-5 text-amber-500 shrink-0" />
                  ) : (
                    <FileText className="h-5 w-5 text-primary shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{f.file.name}</p>
                    <p className="text-xs text-muted-foreground">{(f.file.size / 1024 / 1024).toFixed(2)} MB</p>
                  </div>
                  
                  {f.status === "uploading" && <Loader2 className="h-4 w-4 text-primary animate-spin" />}
                  {f.status === "success" && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                  {f.status === "error" && <AlertCircle className="h-4 w-4 text-destructive" />}
                  
                  {f.status !== "uploading" && f.status !== "success" && (
                    <button 
                      onClick={(e) => { e.stopPropagation(); removeFile(f.id); }}
                      className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      disabled={isUploading}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose} disabled={isUploading}>
            Cancel
          </Button>
          <Button 
            onClick={handleUpload} 
            disabled={files.length === 0 || isUploading}
            className="min-w-[120px]"
          >
            {isUploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Uploading...
              </>
            ) : "Upload & Analyze"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
