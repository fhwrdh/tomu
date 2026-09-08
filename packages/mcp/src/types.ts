// ── Wire shapes ──
//
// Response rows as the API returns them, shared by the tool modules that format
// them. Declared here rather than imported from the server package, which the
// MCP server deliberately does not depend on at runtime.


export interface InventoryItem {
  id: string;
  filmStockId: string;
  manufacturer: string;
  stockName: string;
  iso: number;
  filmType: string;
  format: string;
  form: "factory_roll" | "bulk_roll" | "sheet";
  quantity: number;
  remainingLengthFt?: string | number | null;
  originalLengthFt?: string | number | null;
  expirationDate?: string | null;
  storageLocation: string;
}

export interface InventoryRow {
  id: string;
  displayId?: string | null;
  filmStockId: string;
  manufacturer: string;
  stockName: string;
  iso: number;
  format: string;
  form: "factory_roll" | "bulk_roll" | "sheet";
  quantity: number;
  remainingLengthFt?: string | number | null;
  originalLengthFt?: string | number | null;
  expirationDate?: string | null;
  storageLocation: string;
  costPerRoll?: string | number | null;
  source?: string | null;
}


export interface ActiveRoll {
  id: string;
  cameraId: string | null;
  filmStockId: string;
  format: string;
  form: string;
  status: string;
  loadedAt: string | null;
  frameCount: number;
  framesShot: number;
  manufacturer: string;
  stockName: string;
  iso: number;
  cameraMake: string | null;
  cameraModel: string | null;
}


export interface FieldEventRow {
  id: string; shortId: string; clientId: string; kind: "voice" | "photo";
  status: "pending" | "pinned" | "roll_level"; rollId: string | null; cameraId: string | null;
  frameNumber: number | null; frameProvisional: boolean; sheetId: string | null; capturedAt: string;
  transcript: string | null; fileUrl: string | null;
  shutterSpeed: string | null; aperture: string | null; compensation: string | null; meteringMode: string | null;
  subject: string | null; locationName: string | null; remarks: string | null; sceneDescription: string | null;
  parser: string | null; parseNotes: string | null; review: boolean; editedFields: string[];
}

export interface AnyRoll {
  id: string;
  displayId: string | null;
  devDate: string | null;
  devSeq: number | null;
  status: string;
  manufacturer: string;
  stockName: string;
  cameraMake: string | null;
  cameraModel: string | null;
}


export interface CandidateRoll {
  id: string;
  displayId: string | null;
  ratedIso: number | null;
  format: string;
  manufacturer: string;
  stockName: string;
  stockIso: number;
}

export interface CandidateGroup {
  recipeKey: string;
  tier: "intended" | "history" | "mdc" | "stock-iso";
  recipe: {
    developer: string | null;
    dilution: string | null;
    devTimeSeconds: number | null;
    temperatureC: string | null;
    mdcAsaIso?: number | null;
  } | null;
  rolls: CandidateRoll[];
}


export interface SessionRoll {
  id: string;
  displayId: string | null;
  status: string;
  format: string;
  devId: string | null;
  manufacturer: string;
  stockName: string;
}

export interface DevSession {
  id: string;
  displayId: string | null;
  developer: string;
  dilution: string | null;
  devTimeSeconds: number | null;
  temperatureC: string | null;
  tank: string | null;
  completedAt: string | null;
  developedAt: string | null;
  rolls?: SessionRoll[];
}


export interface TankRow {
  id: string;
  name: string;
  kind: "roll" | "sheet";
  volumeMl: number;
  reelUnits: string | null;
  sheetCapacity: number | null;
  quantity: number;
  agitation: string;
  notes: string | null;
  isActive: boolean;
}


export interface PlanRoll {
  id: string;
  displayId: string | null;
  format: string;
  manufacturer: string;
  stockName: string;
  ratedIso: number | null;
  stockIso: number;
  loadedAt: string | null;
}

export interface PlanLoad {
  tankName: string;
  tankVolumeMl: number;
  tier: "intended" | "history" | "mdc" | "stock-iso";
  recipe: { developer: string | null; dilution: string | null; devTimeSeconds: number | null; temperatureC: string | null };
  rolls: PlanRoll[];
  usedUnits: number;
  capacityUnits: number;
  oldestLoadedAt: string | null;
  mix: { concentrateMl: number; waterMl: number; dilution: string } | null;
  warnings: string[];
}

export interface PlanResponse {
  loads: PlanLoad[];
  remainder: { roll: PlanRoll; reason: string }[];
  warnings: string[];
}
