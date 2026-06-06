import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalProxySettings } from "@/components/settings/GlobalProxySettings";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const saveMutateAsyncMock = vi.fn();
const deleteMutateAsyncMock = vi.fn();
const testMutateAsyncMock = vi.fn();
const scanMutateAsyncMock = vi.fn();

vi.mock("@/hooks/useGlobalProxy", () => ({
  useProxyServers: () => ({
    data: [
      {
        id: "proxy-1",
        name: "Office Proxy",
        url: "http://127.0.0.1:7890",
        sortIndex: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    isLoading: false,
  }),
  useSaveProxyServers: () => ({
    mutateAsync: saveMutateAsyncMock,
    isPending: false,
  }),
  useDeleteProxyServer: () => ({
    mutateAsync: deleteMutateAsyncMock,
    isPending: false,
  }),
  useTestProxy: () => ({
    mutateAsync: testMutateAsyncMock,
    isPending: false,
  }),
  useScanProxies: () => ({
    mutateAsync: scanMutateAsyncMock,
    isPending: false,
  }),
}));

describe("GlobalProxySettings", () => {
  beforeEach(() => {
    saveMutateAsyncMock.mockReset();
    deleteMutateAsyncMock.mockReset();
    testMutateAsyncMock.mockReset();
    scanMutateAsyncMock.mockReset();
    scanMutateAsyncMock.mockResolvedValue([]);
  });

  it("renders existing proxy servers", async () => {
    render(<GlobalProxySettings />);

    expect(screen.getByDisplayValue("Office Proxy")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByDisplayValue("http://127.0.0.1:7890/"),
      ).toBeInTheDocument(),
    );
  });

  it("saves a single proxy server", async () => {
    render(<GlobalProxySettings />);

    fireEvent.change(screen.getByDisplayValue("Office Proxy"), {
      target: { value: "Office Proxy Backup" },
    });

    fireEvent.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => expect(saveMutateAsyncMock).toHaveBeenCalledTimes(1));
    expect(saveMutateAsyncMock).toHaveBeenCalledWith([
      {
        id: "proxy-1",
        name: "Office Proxy Backup",
        url: "http://127.0.0.1:7890/",
        sortIndex: 1,
      },
    ]);
  });

  it("deletes an existing proxy server", async () => {
    render(<GlobalProxySettings />);

    fireEvent.click(screen.getByRole("button", { name: "common.delete" }));

    await waitFor(() =>
      expect(deleteMutateAsyncMock).toHaveBeenCalledWith("proxy-1"),
    );
  });

  it("tests the normalized proxy url", async () => {
    render(<GlobalProxySettings />);

    fireEvent.click(
      screen.getByRole("button", { name: "settings.globalProxy.test" }),
    );

    await waitFor(() =>
      expect(testMutateAsyncMock).toHaveBeenCalledWith(
        "http://127.0.0.1:7890/",
      ),
    );
  });
});
