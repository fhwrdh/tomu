/**
 * The Rolls list. What matters here is that a dozen 4x5 sheets cannot bury the
 * roll that is actually in a camera.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render as rtlRender, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const list = vi.hoisted(() => vi.fn());

vi.mock("../src/services/api.js", () => ({
  rolls: { list, get: vi.fn(), load: vi.fn(), unload: vi.fn(), undoLoad: vi.fn() },
  cameras: { list: vi.fn(async () => ({ data: [] })) },
  filmStocks: { list: vi.fn(async () => ({ data: [] })) },
  ApiError: class extends Error {},
  getToken: () => null,
}));

const { RollsPage } = await import("../src/components/rolls/RollsPage.js");

function roll(over: Record<string, unknown>) {
  return {
    id: crypto.randomUUID(), status: "loaded", format: "35mm", frameCount: 36, framesShot: 0,
    manufacturer: "Ilford", stockName: "Pan F Plus", iso: 50, filmType: "bw",
    cameraMake: "Leica", cameraModel: "M6", tags: [],
    createdAt: "2026-09-07T00:00:00Z", updatedAt: "2026-09-07T00:00:00Z",
    ...over,
  };
}

function render(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  list.mockReset();
});

afterEach(() => cleanup());

describe("format filter", () => {
  const mixed = [
    roll({ manufacturer: "Ilford", stockName: "Pan F Plus", format: "35mm" }),
    roll({ manufacturer: "Ilford", stockName: "HP5 Plus", format: "120", frameCount: 10, framesShot: 2 }),
    ...Array.from({ length: 9 }, () =>
      roll({ manufacturer: "Arista", stockName: "EDU Ultra 100", format: "4x5", frameCount: 1, cameraMake: null, cameraModel: null }),
    ),
  ];

  it("offers only the formats actually present", async () => {
    list.mockResolvedValue({ data: mixed });
    render(<RollsPage />);

    expect(await screen.findByRole("button", { name: "35mm" })).toBeDefined();
    expect(screen.getByRole("button", { name: "120" })).toBeDefined();
    expect(screen.getByRole("button", { name: "4x5" })).toBeDefined();
    // Nothing in the list is 8x10, so it is not offered.
    expect(screen.queryByRole("button", { name: "8x10" })).toBeNull();
  });

  it("narrows the list to one format", async () => {
    list.mockResolvedValue({ data: mixed });
    const user = userEvent.setup();
    render(<RollsPage />);

    await user.click(await screen.findByRole("button", { name: "35mm" }));

    await waitFor(() => expect(screen.getAllByText(/Pan F Plus/)).toHaveLength(1));
    expect(screen.queryByText(/EDU Ultra 100/)).toBeNull();
    expect(screen.queryByText(/HP5 Plus/)).toBeNull();
  });

  it("hides the filter when every roll is the same format", async () => {
    list.mockResolvedValue({ data: [roll({ format: "35mm" }), roll({ format: "35mm" })] });
    render(<RollsPage />);

    await waitFor(() => expect(screen.getAllByText(/Pan F Plus/)).toHaveLength(2));
    expect(screen.queryByRole("button", { name: "All formats" })).toBeNull();
  });
});
