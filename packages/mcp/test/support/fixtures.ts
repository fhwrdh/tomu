// Builders for the rows the Tomu API returns. Each has realistic defaults, so a
// test names only the fields it is about:
//
//   activeRoll({ cameraModel: "Mamiya 7", format: "120" })
//
// Defaults use fixed ids; give explicit ids when a test needs two of a kind.

import type {
  ActiveRoll,
  AnyRoll,
  CandidateGroup,
  CandidateRoll,
  DevSession,
  FieldEventRow,
  InventoryItem,
  InventoryRow,
  PlanLoad,
  PlanRoll,
  SessionRoll,
  TankRow,
} from "../../src/types.js";

export const stock = (o: Partial<{ id: string; manufacturer: string; name: string; iso: number; type: string; aliases: string[] }> = {}) => ({
  id: "stock-hp5",
  manufacturer: "Ilford",
  name: "HP5 Plus",
  iso: 400,
  type: "bw",
  aliases: [] as string[],
  ...o,
});

export const camera = (o: Partial<{ id: string; make: string; model: string; format: string; serialNumber: string | null }> = {}) => ({
  id: "cam-m6",
  make: "Leica",
  model: "M6",
  format: "35mm",
  serialNumber: null,
  ...o,
});

export const lens = (o: Partial<{ id: string; make: string; model: string; focalLengthMm: number | null; maxAperture: string | null; serialNumber: string | null }> = {}) => ({
  id: "lens-35",
  make: "Leica",
  model: "Summicron",
  focalLengthMm: 35,
  maxAperture: "2",
  serialNumber: null,
  ...o,
});

export const activeRoll = (o: Partial<ActiveRoll> = {}): ActiveRoll => ({
  id: "roll-m6",
  cameraId: "cam-m6",
  filmStockId: "stock-hp5",
  format: "35mm",
  form: "factory_roll",
  status: "shooting",
  loadedAt: "2026-09-01T10:00:00.000Z",
  frameCount: 36,
  framesShot: 12,
  manufacturer: "Ilford",
  stockName: "HP5 Plus",
  iso: 400,
  cameraMake: "Leica",
  cameraModel: "M6",
  ...o,
});

export const anyRoll = (o: Partial<AnyRoll> = {}): AnyRoll => ({
  id: "0f3c9a1e-7b2d-4c55-9e01-aa11bb22cc33",
  displayId: "20260906.1",
  devDate: null,
  devSeq: null,
  status: "shot",
  manufacturer: "Ilford",
  stockName: "HP5 Plus",
  cameraMake: "Leica",
  cameraModel: "M6",
  ...o,
});

export const fieldEvent = (o: Partial<FieldEventRow> = {}): FieldEventRow => ({
  id: "5e1d0c2b-0000-4000-8000-000000000001",
  shortId: "K7Q2",
  clientId: "client-1",
  kind: "voice",
  status: "pending",
  rollId: null,
  cameraId: null,
  frameNumber: null,
  frameProvisional: false,
  sheetId: null,
  capturedAt: "2026-09-06T14:32:10.000Z",
  transcript: "two fifty at f eight, the ferry",
  fileUrl: null,
  shutterSpeed: "1/250",
  aperture: "f/8",
  compensation: null,
  meteringMode: null,
  subject: "ferry",
  locationName: null,
  remarks: null,
  sceneDescription: null,
  parser: "tier1",
  parseNotes: null,
  review: false,
  editedFields: [],
  ...o,
});

export const inventoryItem = (o: Partial<InventoryItem> = {}): InventoryItem => ({
  id: "inv-hp5",
  filmStockId: "stock-hp5",
  manufacturer: "Ilford",
  stockName: "HP5 Plus",
  iso: 400,
  filmType: "bw",
  format: "35mm",
  form: "factory_roll",
  quantity: 10,
  remainingLengthFt: null,
  originalLengthFt: null,
  expirationDate: null,
  storageLocation: "fridge",
  ...o,
});

export const inventoryLot = (o: Partial<InventoryRow> = {}): InventoryRow => ({
  id: "inv-hp5",
  displayId: null,
  filmStockId: "stock-hp5",
  manufacturer: "Ilford",
  stockName: "HP5 Plus",
  iso: 400,
  format: "35mm",
  form: "factory_roll",
  quantity: 10,
  remainingLengthFt: null,
  originalLengthFt: null,
  expirationDate: null,
  storageLocation: "fridge",
  costPerRoll: null,
  source: null,
  ...o,
});

export const tank = (o: Partial<TankRow> = {}): TankRow => ({
  id: "tank-p3",
  name: "Paterson 3-reel",
  kind: "roll",
  volumeMl: 1000,
  reelUnits: "3.0",
  sheetCapacity: null,
  quantity: 1,
  agitation: "inversion",
  notes: null,
  isActive: true,
  ...o,
});

export const candidateRoll = (o: Partial<CandidateRoll> = {}): CandidateRoll => ({
  id: "roll-arista-08",
  displayId: "20260501.08",
  ratedIso: null,
  format: "35mm",
  manufacturer: "Arista",
  stockName: "EDU Ultra 100",
  stockIso: 100,
  ...o,
});

export const candidateGroup = (o: Partial<CandidateGroup> = {}): CandidateGroup => ({
  recipeKey: "intended|HC-110|1+47|450",
  tier: "intended",
  recipe: { developer: "HC-110", dilution: "E", devTimeSeconds: 450, temperatureC: "20.0" },
  rolls: [candidateRoll()],
  ...o,
});

export const sessionRoll = (o: Partial<SessionRoll> = {}): SessionRoll => ({
  id: "roll-1",
  displayId: "20260906.1",
  status: "developing",
  format: "35mm",
  devId: "20260914.0736",
  manufacturer: "Ilford",
  stockName: "HP5 Plus",
  ...o,
});

export const devSession = (o: Partial<DevSession> = {}): DevSession => ({
  id: "session-1",
  displayId: "20260914.01",
  developer: "HC-110",
  dilution: "1+47",
  devTimeSeconds: 450,
  temperatureC: "20.0",
  tank: null,
  completedAt: null,
  developedAt: "2026-09-14T19:00:00.000Z",
  rolls: [sessionRoll()],
  ...o,
});

export const planRoll = (o: Partial<PlanRoll> = {}): PlanRoll => ({
  id: "roll-1",
  displayId: "20260906.1",
  format: "35mm",
  manufacturer: "Ilford",
  stockName: "HP5 Plus",
  ratedIso: null,
  stockIso: 400,
  loadedAt: "2026-04-20T10:00:00.000Z",
  ...o,
});

export const planLoad = (o: Partial<PlanLoad> = {}): PlanLoad => ({
  tankName: "Paterson 3-reel",
  tankVolumeMl: 1000,
  tier: "intended",
  recipe: { developer: "HC-110", dilution: "1+47", devTimeSeconds: 450, temperatureC: "20.0" },
  rolls: [planRoll()],
  usedUnits: 3,
  capacityUnits: 3,
  oldestLoadedAt: "2026-04-20T10:00:00.000Z",
  mix: { concentrateMl: 20.8, waterMl: 979.2, dilution: "1+47" },
  warnings: [],
  ...o,
});
