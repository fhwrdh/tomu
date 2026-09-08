/**
 * Roll dialogs shared by the Rolls page and the capture screen. Loading and
 * unloading are server-side operations — the load decrements inventory and
 * mints the roll, the unload allocates the display id — so both need signal,
 * and the capture screen says so rather than pretending otherwise.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FILM_FORMATS, FILM_FORMAT_LABELS } from "@tomu/shared";
import type { CreateRoll } from "@tomu/shared";
import { cameras, filmStocks, rolls } from "../../services/api.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Select } from "../ui/select.js";
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "../ui/dialog.js";

export function localDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  // The control lives inside the label, so it is implicitly associated: tapping
  // the text focuses the input, and screen readers announce the two together.
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-foreground">
        {label}
        {required && <span className="text-danger"> *</span>}
      </span>
      {children}
    </label>
  );
}

export function LoadRollDialog({ open, onClose, cameraId }: { open: boolean; onClose: () => void; cameraId?: string }) {
  const queryClient = useQueryClient();
  const stocksQuery = useQuery({ queryKey: ["film-stocks"], queryFn: () => filmStocks.list() });
  const camerasQuery = useQuery({ queryKey: ["cameras"], queryFn: () => cameras.list() });

  const [form, setForm] = useState<{
    filmStockId: string;
    cameraId: string;
    format: (typeof FILM_FORMATS)[number];
    ratedIso: string;
  }>({ filmStockId: "", cameraId: cameraId ?? "", format: "35mm", ratedIso: "" });

  const mutation = useMutation({
    mutationFn: (body: CreateRoll) => rolls.load(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rolls"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      onClose();
      setForm({ filmStockId: "", cameraId: cameraId ?? "", format: "35mm", ratedIso: "" });
    },
  });

  const stocks = stocksQuery.data?.data ?? [];
  const cams = camerasQuery.data?.data ?? [];
  const selectedStock = stocks.find((s) => s.id === form.filmStockId);

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Load Roll</DialogTitle>
      </DialogHeader>
      <DialogContent className="space-y-3">
        <Field label="Film Stock" required>
          <Select value={form.filmStockId} onChange={(e) => setForm({ ...form, filmStockId: e.target.value })}>
            <option value="">Select film stock</option>
            {stocks.map((s) => (
              <option key={s.id} value={s.id}>
                {s.manufacturer} {s.name} (ISO {s.iso})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Camera" required>
          <Select value={form.cameraId} onChange={(e) => setForm({ ...form, cameraId: e.target.value })}>
            <option value="">Select camera</option>
            {cams.map((c) => (
              <option key={c.id} value={c.id}>
                {c.make} {c.model}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Format" required>
            <Select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value as typeof form.format })}>
              {FILM_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {FILM_FORMAT_LABELS[f]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={selectedStock ? `Rated ISO (box ${selectedStock.iso})` : "Rated ISO"}>
            <Input
              type="number"
              placeholder={selectedStock ? String(selectedStock.iso) : "ISO"}
              value={form.ratedIso}
              onChange={(e) => setForm({ ...form, ratedIso: e.target.value })}
              min={1}
            />
          </Field>
        </div>
        {mutation.isError && (
          <div className="text-xs text-danger">{(mutation.error as Error).message}</div>
        )}
      </DialogContent>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={() => {
            const body: CreateRoll = {
              filmStockId: form.filmStockId,
              cameraId: form.cameraId,
              format: form.format,
            };
            if (form.ratedIso) body.ratedIso = Number(form.ratedIso);
            mutation.mutate(body);
          }}
          disabled={!form.filmStockId || !form.cameraId || mutation.isPending}
        >
          {mutation.isPending ? "Loading…" : "Load"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

export function UnloadDialog({ open, onClose, rollId }: { open: boolean; onClose: () => void; rollId: string }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");

  const mutation = useMutation({
    mutationFn: () => rolls.unload(rollId, { localDate: localDate(), note: note || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rolls"] });
      onClose();
      setNote("");
    },
  });

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Unload Roll</DialogTitle>
      </DialogHeader>
      <DialogContent className="space-y-3">
        <div className="text-xs text-muted-foreground">
          Assigns a display ID based on today's local date. The roll can no longer be shot after this.
        </div>
        <Field label="Final note (optional)">
          <Input
            placeholder="e.g. pulled early, light leak suspected"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </DialogContent>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? "Unloading…" : "Unload"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

