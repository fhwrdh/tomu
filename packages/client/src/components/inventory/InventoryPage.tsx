import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, AlertTriangle } from "lucide-react";
import { FILM_FORMAT_LABELS, FILM_TYPE_LABELS, INVENTORY_FORM_LABELS, STORAGE_LOCATIONS } from "@tomu/shared";
import type { CreateFilmInventoryItem, CreateFilmStock, InventoryForm } from "@tomu/shared";
import { filmStocks, inventory, type InventoryItemWithStock } from "../../services/api.js";
import { Button } from "../ui/button.js";
import { Badge } from "../ui/badge.js";
import { Input } from "../ui/input.js";
import { Select } from "../ui/select.js";
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "../ui/dialog.js";

function formatInventoryItem(item: { form: string; quantity: number; remainingLengthFt?: string | number | null; originalLengthFt?: string | number | null; format: string }) {
  if (item.form === "bulk_roll") {
    const remaining = item.remainingLengthFt ? Number(item.remainingLengthFt) : 0;
    const original = item.originalLengthFt ? Number(item.originalLengthFt) : 0;
    return `${remaining}' / ${original}' bulk (${item.format})`;
  }
  if (item.form === "sheet") {
    return `${item.quantity} sheets (${item.format})`;
  }
  return `${item.quantity} rolls (${item.format})`;
}

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

  // Group inventory items by stock
  const itemsByStock = new Map<string, InventoryItemWithStock[]>();
  if (summary) {
    for (const item of summary.items) {
      const key = item.filmStockId;
      if (!itemsByStock.has(key)) itemsByStock.set(key, []);
      itemsByStock.get(key)!.push(item);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Film Inventory</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setAddStockOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> New Stock
          </Button>
          <Button size="sm" onClick={() => setAddInventoryOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Add Inventory
          </Button>
        </div>
      </div>

      {/* Inventory by stock */}
      {stocks.length > 0 && (
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-card text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Stock</th>
                <th className="px-3 py-2 font-medium">On Hand</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {stocks.map((stock) => {
                const items = itemsByStock.get(stock.id) || [];
                return (
                  <tr key={stock.id} className="hover:bg-card/50">
                    <td className="px-3 py-2.5">
                      <span className="font-medium">{stock.manufacturer} {stock.name}</span>
                      <div className="mt-1 flex gap-1.5">
                        <Badge variant="blue">ISO {stock.iso}</Badge>
                        <Badge variant="secondary">
                          {FILM_TYPE_LABELS[stock.type as keyof typeof FILM_TYPE_LABELS]}
                        </Badge>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      {items.length > 0 ? (
                        <div className="space-y-0.5">
                          {items.map((item) => (
                            <div key={item.id} className="text-sm">
                              <span className={item.form === "bulk_roll"
                                ? (Number(item.remainingLengthFt) <= 10 ? "text-warning font-medium" : "text-success font-medium")
                                : (item.quantity <= 2 ? "text-warning font-medium" : "text-success font-medium")
                              }>
                                {formatInventoryItem(item)}
                              </span>
                              {item.storageLocation !== "fridge" && (
                                <span className="ml-1.5 text-xs text-muted-foreground">
                                  ({item.storageLocation.replace("_", " ")})
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">--</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {stocks.length === 0 && !stocksQuery.isLoading && (
        <div className="rounded-md border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          No film stocks yet. Add your first stock to get started.
        </div>
      )}

      {/* Expiring soon */}
      {summary && summary.expiringSoon.length > 0 && (
        <div className="overflow-hidden rounded-md border border-warning/30">
          <div className="flex items-center gap-2 border-b border-warning/30 bg-warning/5 px-3 py-2 text-sm font-medium text-warning">
            <AlertTriangle className="h-4 w-4" /> Expiring Soon
          </div>
          <div className="divide-y divide-border">
            {summary.expiringSoon.map((item) => (
              <div key={item.id} className="flex items-center justify-between px-3 py-2.5 text-sm">
                <div>
                  <span className="font-medium">{item.manufacturer} {item.stockName}</span>
                  <span className="ml-2 text-muted-foreground">
                    {formatInventoryItem(item as any)}
                  </span>
                </div>
                <span className="text-xs text-warning">exp {item.expirationDate}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <AddFilmStockDialog open={addStockOpen} onClose={() => setAddStockOpen(false)} />
      <AddInventoryDialog open={addInventoryOpen} onClose={() => setAddInventoryOpen(false)} stocks={stocks} />
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-foreground">
        {label}{required && <span className="text-danger"> *</span>}
      </label>
      {children}
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
  });

  const mutation = useMutation({
    mutationFn: (body: CreateFilmStock) => filmStocks.create(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["film-stocks"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      onClose();
      setForm({ manufacturer: "", name: "", iso: 400, type: "bw" });
    },
  });

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Add Film Stock</DialogTitle>
      </DialogHeader>
      <DialogContent className="space-y-3">
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
      </DialogContent>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
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
  stocks: Array<{ id: string; manufacturer: string; name: string }>;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    filmStockId: "",
    format: "35mm" as const,
    form: "factory_roll" as InventoryForm,
    quantity: 1,
    remainingLengthFt: undefined as number | undefined,
    originalLengthFt: undefined as number | undefined,
    expirationDate: "",
    storageLocation: "fridge" as const,
    costPerRoll: undefined as number | undefined,
  });

  const isBulk = form.form === "bulk_roll";

  const mutation = useMutation({
    mutationFn: (body: CreateFilmInventoryItem) => inventory.create(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["film-stocks"] });
      onClose();
      setForm({ filmStockId: "", format: "35mm", form: "factory_roll", quantity: 1, remainingLengthFt: undefined, originalLengthFt: undefined, expirationDate: "", storageLocation: "fridge", costPerRoll: undefined });
    },
  });

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Add Inventory</DialogTitle>
      </DialogHeader>
      <DialogContent className="space-y-3">
        <Field label="Film Stock" required>
          <Select value={form.filmStockId} onChange={(e) => setForm({ ...form, filmStockId: e.target.value })}>
            <option value="">Select film stock</option>
            {stocks.map((s) => (
              <option key={s.id} value={s.id}>{s.manufacturer} {s.name}</option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Format" required>
            <Select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value as typeof form.format })}>
              {Object.entries(FILM_FORMAT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Form" required>
            <Select value={form.form} onChange={(e) => setForm({ ...form, form: e.target.value as InventoryForm })}>
              {Object.entries(INVENTORY_FORM_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
        </div>
        {isBulk ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Total Length (ft)" required>
              <Input type="number" value={form.originalLengthFt ?? ""} onChange={(e) => {
                const val = e.target.value ? Number(e.target.value) : undefined;
                setForm({ ...form, originalLengthFt: val, remainingLengthFt: val });
              }} min={1} />
            </Field>
            <Field label="Remaining (ft)">
              <Input type="number" value={form.remainingLengthFt ?? ""} onChange={(e) => setForm({ ...form, remainingLengthFt: e.target.value ? Number(e.target.value) : undefined })} min={0} />
            </Field>
          </div>
        ) : (
          <Field label={form.form === "sheet" ? "Sheets" : "Rolls"} required>
            <Input type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) || 1 })} min={1} max={500} />
          </Field>
        )}
        <Field label="Expiration Date">
          <Input type="date" value={form.expirationDate} onChange={(e) => setForm({ ...form, expirationDate: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Storage">
            <Select value={form.storageLocation} onChange={(e) => setForm({ ...form, storageLocation: e.target.value as typeof form.storageLocation })}>
              {STORAGE_LOCATIONS.map((loc) => <option key={loc} value={loc}>{loc.replace("_", " ")}</option>)}
            </Select>
          </Field>
          <Field label="Cost ($)">
            <Input type="number" value={form.costPerRoll ?? ""} onChange={(e) => setForm({ ...form, costPerRoll: e.target.value ? Number(e.target.value) : undefined })} min={0} step="0.01" />
          </Field>
        </div>
      </DialogContent>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => mutation.mutate(form)} disabled={!form.filmStockId || mutation.isPending}>
          {mutation.isPending ? "Adding..." : "Add"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
