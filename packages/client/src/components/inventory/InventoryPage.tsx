import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, AlertTriangle } from "lucide-react";
import { FILM_FORMAT_LABELS, FILM_TYPE_LABELS, STORAGE_LOCATIONS } from "@filmlog/shared";
import type { CreateFilmInventoryItem, CreateFilmStock } from "@filmlog/shared";
import { filmStocks, inventory } from "../../services/api.js";
import { Button } from "../ui/button.js";
import { Badge } from "../ui/badge.js";
import { Card, CardContent } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Select } from "../ui/select.js";
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "../ui/dialog.js";

export function InventoryPage() {
  const queryClient = useQueryClient();
  const [addStockOpen, setAddStockOpen] = useState(false);
  const [addInventoryOpen, setAddInventoryOpen] = useState(false);

  const summaryQuery = useQuery({
    queryKey: ["inventory", "summary"],
    queryFn: () => inventory.summary(),
  });

  const stocksQuery = useQuery({
    queryKey: ["film-stocks"],
    queryFn: () => filmStocks.list(),
  });

  const summary = summaryQuery.data?.data;
  const stocks = stocksQuery.data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Film Inventory</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setAddStockOpen(true)}>
            <Plus className="h-4 w-4" /> New Stock
          </Button>
          <Button size="sm" onClick={() => setAddInventoryOpen(true)}>
            <Plus className="h-4 w-4" /> Add Rolls
          </Button>
        </div>
      </div>

      {/* Summary stats */}
      {summary && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">Total Rolls</p>
            <p className="text-3xl font-bold">{summary.totalRolls}</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">Film Stocks</p>
            <p className="text-3xl font-bold">{summary.byStock.length}</p>
          </div>
          {summary.expiringSoon.length > 0 && (
            <div className="rounded-lg border border-orange-500/30 p-4">
              <p className="flex items-center gap-1 text-sm text-orange-400">
                <AlertTriangle className="h-3.5 w-3.5" /> Expiring Soon
              </p>
              <p className="text-3xl font-bold text-orange-400">{summary.expiringSoon.length}</p>
            </div>
          )}
        </div>
      )}

      {/* Inventory by stock */}
      {summary?.byStock.map((stock) => (
        <Card key={stock.filmStockId}>
          <CardContent className="flex items-start justify-between pt-4">
            <div>
              <p className="font-semibold">
                {stock.manufacturer} {stock.stockName}
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <Badge variant="blue">{stock.format}</Badge>
                <Badge variant="purple">ISO {stock.iso}</Badge>
                <Badge variant="secondary">
                  {FILM_TYPE_LABELS[stock.filmType as keyof typeof FILM_TYPE_LABELS]}
                </Badge>
              </div>
            </div>
            <span
              className={`text-2xl font-bold ${stock.totalRolls <= 2 ? "text-orange-400" : "text-green-400"}`}
            >
              {stock.totalRolls}
            </span>
          </CardContent>
        </Card>
      ))}

      {stocks.length === 0 && !stocksQuery.isLoading && (
        <p className="py-12 text-center text-muted-foreground">
          No film stocks yet. Add your first stock to get started.
        </p>
      )}

      {/* Expiring soon */}
      {summary && summary.expiringSoon.length > 0 && (
        <>
          <h3 className="flex items-center gap-2 text-lg font-semibold text-orange-400">
            <AlertTriangle className="h-5 w-5" /> Expiring Soon
          </h3>
          {summary.expiringSoon.map((item) => (
            <Card key={item.id} className="border-orange-500/30">
              <CardContent className="flex items-center justify-between pt-4">
                <div>
                  <p className="font-semibold">
                    {item.manufacturer} {item.stockName}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {item.format} &middot; {item.storageLocation} &middot; {item.quantity} rolls
                  </p>
                </div>
                <span className="text-sm text-orange-400">Exp: {item.expirationDate}</span>
              </CardContent>
            </Card>
          ))}
        </>
      )}

      <AddFilmStockDialog open={addStockOpen} onClose={() => setAddStockOpen(false)} />
      <AddInventoryDialog open={addInventoryOpen} onClose={() => setAddInventoryOpen(false)} stocks={stocks} />
    </div>
  );
}

function AddFilmStockDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CreateFilmStock>({
    manufacturer: "",
    name: "",
    iso: 400,
    type: "bw",
    format: "35mm",
  });

  const mutation = useMutation({
    mutationFn: (body: CreateFilmStock) => filmStocks.create(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["film-stocks"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      onClose();
      setForm({ manufacturer: "", name: "", iso: 400, type: "bw", format: "35mm" });
    },
  });

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Add Film Stock</DialogTitle>
      </DialogHeader>
      <DialogContent className="space-y-4">
        <Field label="Manufacturer" required>
          <Input placeholder="e.g. Kodak, Ilford, Fuji" value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} />
        </Field>
        <Field label="Name" required>
          <Input placeholder="e.g. Tri-X 400, Portra 400" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="ISO" required>
          <Input type="number" value={form.iso} onChange={(e) => setForm({ ...form, iso: Number(e.target.value) || 400 })} min={1} />
        </Field>
        <Field label="Type" required>
          <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as typeof form.type })}>
            {Object.entries(FILM_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Format" required>
          <Select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value as typeof form.format })}>
            {Object.entries(FILM_FORMAT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
      </DialogContent>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={() => mutation.mutate(form)} disabled={!form.manufacturer || !form.name || mutation.isPending}>
          {mutation.isPending ? "Adding..." : "Add Stock"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function AddInventoryDialog({
  open,
  onClose,
  stocks,
}: {
  open: boolean;
  onClose: () => void;
  stocks: Array<{ id: string; manufacturer: string; name: string; format: string }>;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    filmStockId: "",
    quantity: 1,
    expirationDate: "",
    storageLocation: "fridge" as const,
    costPerRoll: undefined as number | undefined,
  });

  const mutation = useMutation({
    mutationFn: (body: CreateFilmInventoryItem) => inventory.create(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["film-stocks"] });
      onClose();
      setForm({ filmStockId: "", quantity: 1, expirationDate: "", storageLocation: "fridge", costPerRoll: undefined });
    },
  });

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Add Film Rolls</DialogTitle>
      </DialogHeader>
      <DialogContent className="space-y-4">
        <Field label="Film Stock" required>
          <Select value={form.filmStockId} onChange={(e) => setForm({ ...form, filmStockId: e.target.value })}>
            <option value="">Select film stock</option>
            {stocks.map((s) => (
              <option key={s.id} value={s.id}>{s.manufacturer} {s.name} ({s.format})</option>
            ))}
          </Select>
        </Field>
        <Field label="Quantity" required>
          <Input type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) || 1 })} min={1} max={100} />
        </Field>
        <Field label="Expiration Date">
          <Input type="date" value={form.expirationDate} onChange={(e) => setForm({ ...form, expirationDate: e.target.value })} />
        </Field>
        <Field label="Storage Location">
          <Select value={form.storageLocation} onChange={(e) => setForm({ ...form, storageLocation: e.target.value as typeof form.storageLocation })}>
            {STORAGE_LOCATIONS.map((loc) => <option key={loc} value={loc}>{loc.replace("_", " ")}</option>)}
          </Select>
        </Field>
        <Field label="Cost per Roll ($)">
          <Input type="number" value={form.costPerRoll ?? ""} onChange={(e) => setForm({ ...form, costPerRoll: e.target.value ? Number(e.target.value) : undefined })} min={0} step="0.01" />
        </Field>
      </DialogContent>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={() => mutation.mutate(form)} disabled={!form.filmStockId || mutation.isPending}>
          {mutation.isPending ? "Adding..." : "Add to Inventory"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">
        {label}{required && <span className="text-destructive"> *</span>}
      </label>
      {children}
    </div>
  );
}
