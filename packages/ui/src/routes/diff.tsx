import { useRouteError, useNavigate } from "react-router";
import type { Route } from "./+types/diff";
import { queryClient } from "../lib/query-client";
import { diffOptions } from "../queries/diff";
import { repoInfoOptions } from "../queries/info";
import { viewedOptions } from "../queries/viewed";
import { DiffPage } from "../components/diff/diff-page";
import { ErrorPage } from "../components/error-page";
import { allowOneLargeDiffLoad, consumeLargeDiffLoad, getLargeDiffSummary } from "../lib/large-diff-gate";
import { useTheme } from "../hooks/use-theme";

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const url = new URL(request.url);
  const ref = url.searchParams.get("ref") || "work";
  const theme = url.searchParams.get("theme") as "light" | "dark" | null;
  const view = url.searchParams.get("view") as "split" | "unified" | null;

  if (!consumeLargeDiffLoad(url.searchParams.get("load"))) {
    const largeDiff = await getLargeDiffSummary(ref);
    if (largeDiff) return { ref, theme, view, largeDiff };
  }

  await Promise.all([
    queryClient.ensureQueryData(diffOptions(false, ref)),
    queryClient.ensureQueryData(repoInfoOptions(ref)),
    queryClient.ensureQueryData(viewedOptions(ref)),
  ]);

  return { ref, theme, view, largeDiff: null };
}

export default function DiffRoute({ loaderData }: Route.ComponentProps) {
  if (loaderData.largeDiff) {
    return <LargeDiffPrompt fileCount={loaderData.largeDiff.fileCount} initialTheme={loaderData.theme} />;
  }
  return <DiffPage />;
}

function LargeDiffPrompt({ fileCount, initialTheme }: { fileCount: number; initialTheme: "light" | "dark" | null }) {
  const navigate = useNavigate();
  useTheme(initialTheme);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-bg text-text font-sans gap-4 p-6 text-center">
      <h1 className="text-lg font-medium">Large diff not loaded</h1>
      <p className="text-sm text-text-secondary">
        {fileCount.toLocaleString()} files changed. Loading the full diff may slow your browser.
      </p>
      <button
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover cursor-pointer"
        onClick={() => {
          const url = new URL(window.location.href);
          url.searchParams.set("load", allowOneLargeDiffLoad());
          navigate(`${url.pathname}${url.search}`);
        }}
      >
        Load diff
      </button>
    </div>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();

  return (
    <ErrorPage
      error={error}
      actions={[
        { label: "View working changes", primary: true, onClick: () => navigate("/diff") },
        { label: "Browse files", onClick: () => navigate("/tree") },
      ]}
    />
  );
}
