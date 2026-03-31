import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus } from "lucide-react";
import { FILM_FORMAT_LABELS } from "@filmlog/shared";
import type { CreateCamera, CreateLens } from "@filmlog/shared";
import { cameras, lenses } from "../../services/api.js";
import { Button } from "../ui/button.js";
import { Badge } from "../ui/badge.js";
import { Card, CardContent } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Select } from "../ui/select.js";
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "../ui/dialog.js";
import { cn } from "../../lib/utils.js";

export function GearPage() {
  const camerasQuery = useQuery({ queryKey: ["cameras"], queryFn: () => cameras.list() });
  const lensesQuery = useQuery({ queryKey: ["lenses"], queryFn: () => lenses.list() });
  const [tab, setTab] = useState<"cameras" | "lenses">("cameras");
  const [addCameraOpen, setAddCameraOpen] = useState(false);
  const [addLensOpen, setAddLensOpen] = useState(false);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Gear</h2>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-secondary p-1">
        {(["cameras", "lenses"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              tab === t ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t === "cameras" ? "Cameras" : "Lenses"}
          </button>
        ))}
      </div>

      {/* Cameras tab */}
      {tab === "cameras" && (
        <>
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setAddCameraOpen(true)}>
              <Plus className="h-4 w-4" /> Add Camera
            </Button>
          </div>
          {camerasQuery.data?.data.map((camera) => (
            <Card key={camera.id}>
              <CardContent className="pt-4">
                <p className="font-semibold">{camera.make} {camera.model}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <Badge variant="blue">{FILM_FORMAT_LABELS[camera.format as keyof typeof FILM_FORMAT_LABELS]}</Badge>
                  {camera.serialNumber && <Badge variant="secondary">S/N: {camera.serialNumber}</Badge>}
                </div>
                {camera.notes && <p className="mt-2 text-sm text-muted-foreground">{camera.notes}</p>}
              </CardContent>
            </Card>
          ))}
          {camerasQuery.data?.data.length === 0 && (
            <p className="py-12 text-center text-muted-foreground">No cameras yet. Add your first camera.</p>
          )}
        </>
      )}

      {/* Lenses tab */}
      {tab === "lenses" && (
        <>
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setAddLensOpen(true)}>
              <Plus className="h-4 w-4" /> Add Lens
            </Button>
          </div>
          {lensesQuery.data?.data.map((lens) => (
            <Card key={lens.id}>
              <CardContent className="pt-4">
                <p className="font-semibold">{lens.make} {lens.model}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {lens.focalLengthMm && <Badge variant="blue">{lens.focalLengthMm}mm</Badge>}
                  {lens.maxAperture && <Badge variant="purple">f/{lens.maxAperture}</Badge>}
                  {lens.serialNumber && <Badge variant="secondary">S/N: {lens.serialNumber}</Badge>}
                </div>
                {lens.notes && <p className="mt-2 text-sm text-muted-foreground">{lens.notes}</p>}
              </CardContent>
            </Card>
          ))}
          {lensesQuery.data?.data.length === 0 && (
            <p className="py-12 text-center text-muted-foreground">No lenses yet. Add your first lens.</p>
          )}
        </>
      )}

      <AddCameraDialog open={addCameraOpen} onClose={() => setAddCameraOpen(false)} />
      <AddLensDialog open={addLensOpen} onClose={() => setAddLensOpen(false)} />
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">
        {label}{required && <span className="text-red-400"> *</span>}
      </label>
      {children}
    </div>
  );
}

function AddCameraDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CreateCamera>({ make: "", model: "", format: "35mm" });

  const mutation = useMutation({
    mutationFn: (body: CreateCamera) => cameras.create(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cameras"] });
      onClose();
      setForm({ make: "", model: "", format: "35mm" });
    },
  });

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader><DialogTitle>Add Camera</DialogTitle></DialogHeader>
      <DialogContent className="space-y-4">
        <Field label="Make" required>
          <Input placeholder="e.g. Nikon, Hasselblad, Leica" value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} />
        </Field>
        <Field label="Model" required>
          <Input placeholder="e.g. F3, 500C/M, M6" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
        </Field>
        <Field label="Format" required>
          <Select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value as typeof form.format })}>
            {Object.entries(FILM_FORMAT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Serial Number">
          <Input value={form.serialNumber ?? ""} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} />
        </Field>
        <Field label="Notes">
          <Input value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
      </DialogContent>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={() => mutation.mutate(form)} disabled={!form.make || !form.model || mutation.isPending}>
          {mutation.isPending ? "Adding..." : "Add Camera"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function AddLensDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CreateLens>({ make: "", model: "" });

  const mutation = useMutation({
    mutationFn: (body: CreateLens) => lenses.create(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lenses"] });
      onClose();
      setForm({ make: "", model: "" });
    },
  });

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader><DialogTitle>Add Lens</DialogTitle></DialogHeader>
      <DialogContent className="space-y-4">
        <Field label="Make" required>
          <Input placeholder="e.g. Nikon, Zeiss, Canon" value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} />
        </Field>
        <Field label="Model" required>
          <Input placeholder="e.g. Nikkor 50mm f/1.4" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
        </Field>
        <Field label="Focal Length (mm)">
          <Input type="number" value={form.focalLengthMm ?? ""} onChange={(e) => setForm({ ...form, focalLengthMm: e.target.value ? Number(e.target.value) : undefined })} min={1} />
        </Field>
        <Field label="Max Aperture">
          <Input placeholder="e.g. 1.4, 2.8" value={form.maxAperture ?? ""} onChange={(e) => setForm({ ...form, maxAperture: e.target.value })} />
        </Field>
      </DialogContent>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={() => mutation.mutate(form)} disabled={!form.make || !form.model || mutation.isPending}>
          {mutation.isPending ? "Adding..." : "Add Lens"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
