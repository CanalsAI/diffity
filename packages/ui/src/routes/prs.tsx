import { useNavigate, useRouteError } from "react-router";
import { PrsPage } from "../components/prs/prs-page";
import { ErrorPage } from "../components/error-page";

export default function PrsRoute() {
  return <PrsPage />;
}

export function ErrorBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();

  return (
    <ErrorPage
      error={error}
      actions={[
        { label: "Reload", primary: true, onClick: () => window.location.reload() },
        { label: "View diff", onClick: () => navigate("/diff") },
      ]}
    />
  );
}
