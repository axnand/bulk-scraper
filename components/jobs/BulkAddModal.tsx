"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface Props {
  open: boolean;
  onClose: () => void;
  requisitionId: string;
  onSuccess: () => void;
}

export function BulkAddModal({ open, onClose, requisitionId, onSuccess }: Props) {
  const [urls, setUrls] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ totalTasks: number; invalidUrls?: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!urls.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/requisitions/${requisitionId}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Failed to start run");
      } else {
        setResult(json);
        setUrls("");
        onSuccess();
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    if (loading) return;
    setUrls("");
    setResult(null);
    setError(null);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Bulk Add Candidates</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Future: Document upload zone */}
          <div className="rounded-lg border-2 border-dashed border-border p-6 text-center opacity-40 cursor-not-allowed">
            <p className="text-sm text-muted-foreground">Document upload (PDF/DOCX/ZIP)</p>
            <p className="text-xs text-muted-foreground mt-1">Coming soon</p>
          </div>

          <div className="space-y-1.5">
            <Label>LinkedIn URLs <span className="text-muted-foreground font-normal">(one per line)</span></Label>
            <Textarea
              placeholder={"https://linkedin.com/in/username...\nhttps://linkedin.com/in/another..."}
              value={urls}
              onChange={e => setUrls(e.target.value)}
              rows={8}
              className="font-mono text-xs resize-none"
            />
          </div>

          {result && (
            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-sm text-emerald-400">
              Run started with {result.totalTasks} candidate{result.totalTasks === 1 ? "" : "s"}.
              {result.invalidUrls && result.invalidUrls.length > 0 && (
                <p className="text-xs text-amber-400 mt-1">{result.invalidUrls.length} invalid URLs skipped.</p>
              )}
            </div>
          )}
          {error && (
            <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-sm text-rose-400">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading || !urls.trim()}>
            {loading ? "Processing..." : "Upload & Process"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
